// src/services/spriteSync.js

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import { fetchGameVersion, invalidateVersionCache } from "../core/game/version.js";
import { invalidateAllCaches } from "../core/game/cache.js";
import { loadStoredVersion, saveVersion } from "../core/game/versionStorage.js";
import {
  loadStoredAtlases,
  compareAllAtlases,
  updateStoredAtlases,
} from "../core/game/atlasStorage.js";
import { getBaseUrl } from "../assets/assets.js";
import {
  loadManifest,
  getBundleByName,
  extractJsonFiles,
  extractAllSources,
} from "../assets/manifest.js";
import { resolvePetsRiveFiles, resolveRiveUrl } from "../assets/sprites/riveManifest.js";
import { RIVE_FRAMES_FILE, clearRiveFramesCache } from "../assets/sprites/riveFrames.js";
import { loadStoredRiveAssets, saveRiveAsset } from "../core/game/riveStorage.js";
import { syncPetAnimations } from "./animationSync.js";
import { syncRiveInventory, listRiveFilesToInspect } from "./riveSync.js";
import { planPetSprites, planDecorSprites } from "./syncPlan.js";
import { runSyncTask, killSyncTasks } from "./syncTaskRunner.js";
import { joinUrl } from "../utils/url.js";

let isSyncing = false;
// Set when a forced resync (game update) arrives while a sync is already
// running. Without this, that request silently no-ops (see checkAndSyncSprites'
// isSyncing guard below) and the resync that's supposed to pick up the new
// version never fires — this is what left the data stale for hours after the
// 2026-08-05 update, back when the signal was a WebSocket close code.
let pendingForceResync = false;

let versionWatchTimer = null;
let watchedVersion = null;

// Les étapes lourdes tournent chacune dans un processus fils, tué à son délai
// (voir syncTaskWorker.js). Durées observées en prod : inventaire ~7 s quand
// les 10 .riv sont à inspecter, PNG de pets ~40 s, décors ~6 s, découpe des
// atlas 4-70 s. Les délais laissent large : à nice 10 derrière l'API, sur
// 2 vCPU, un rendu peut prendre plusieurs fois plus longtemps.
const RIVE_INVENTORY_TIMEOUT = 4 * 60 * 1000;
const PET_SPRITES_TIMEOUT = 5 * 60 * 1000;
const DECOR_EXPORT_TIMEOUT = 2 * 60 * 1000;
const ATLAS_EXPORT_TIMEOUT = 6 * 60 * 1000;

// Garde-fou de dernier recours contre une sync bloquée dans l'API elle-même
// (les fils, eux, sont bornés ci-dessus) : il tue le processus, que pm2
// relance. Il doit couvrir la somme des délais des fils, sinon une grosse maj
// du jeu, lente mais saine, se transformerait en redémarrage en boucle.
const SYNC_TIMEOUT = 20 * 60 * 1000;

/**
 * Check if sprites directory exists and has content.
 * Returns true if sprites need to be exported (dir missing or empty).
 */
async function needsInitialExport() {
  const exportDir = config.sprites.exportDir;
  const spriteDir = `${exportDir}/sprite`;

  try {
    const stats = await fs.stat(spriteDir);
    if (!stats.isDirectory()) return true;

    const entries = await fs.readdir(spriteDir);
    if (entries.length === 0) return true;

    return false;
  } catch (err) {
    // Directory doesn't exist
    return true;
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function riveSidecarPath(category) {
  return path.join(config.sprites.exportDir, "sprite", category, RIVE_FRAMES_FILE);
}

/**
 * Fetch JSON from URL.
 */
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

/**
 * Fetch all atlas JSON files from the game server.
 * Returns a map of sourceJson -> atlasJson.
 * Also discovers JSON files for ktx2/webp atlases not listed in manifest.
 */
async function fetchAllAtlases(baseUrl) {
  const manifest = await loadManifest({ baseUrl });
  if (!manifest) throw new Error("Failed to load manifest");

  const bundle = getBundleByName(manifest, "default");
  if (!bundle) throw new Error("No 'default' bundle in manifest");

  // Get explicitly listed JSON files
  const jsonFiles = extractJsonFiles(bundle);
  const atlasJsonFiles = new Set(
    jsonFiles.filter((f) => f.includes("sprite") || f.includes("tiles") || f.includes("weather"))
  );

  // Also look for image files (ktx2/webp) and try to find corresponding JSON
  const allSources = extractAllSources(bundle);
  const imageFiles = allSources.filter(
    (f) =>
      (f.endsWith(".ktx2") || f.endsWith(".webp")) &&
      (f.includes("sprite") || f.includes("tiles") || f.includes("weather"))
  );

  // Add potential JSON files for atlas images
  for (const img of imageFiles) {
    const jsonFile = img.replace(/\.(ktx2|webp)$/, ".json");
    if (!atlasJsonFiles.has(jsonFile)) {
      atlasJsonFiles.add(jsonFile);
    }
  }

  logger.debug({ atlasFiles: Array.from(atlasJsonFiles) }, "Atlas files to fetch");

  const atlasMap = {};
  const queue = Array.from(atlasJsonFiles);

  while (queue.length) {
    const jsonFile = queue.shift();
    if (atlasMap[jsonFile]) continue;

    try {
      const url = joinUrl(baseUrl, jsonFile);
      const atlasJson = await fetchJson(url);
      atlasMap[jsonFile] = atlasJson;
      logger.debug({ jsonFile, frameCount: Object.keys(atlasJson?.frames || {}).length }, "Atlas loaded");

      // TexturePacker multi-pack : les atlases supplémentaires (sprites-1/2/3)
      // ne sont listés que dans meta.related_multi_packs du premier atlas.
      // Sans ça, on rate des centaines de frames (ex. Cardoon).
      const related = atlasJson?.meta?.related_multi_packs;
      if (Array.isArray(related)) {
        const dir = jsonFile.includes("/") ? jsonFile.replace(/[^/]+$/, "") : "";
        for (const rel of related) {
          if (typeof rel !== "string") continue;
          const relPath = dir + rel;
          if (!atlasMap[relPath] && !queue.includes(relPath)) queue.push(relPath);
        }
      }
    } catch (err) {
      logger.warn({ jsonFile, error: err.message }, "Failed to fetch atlas, skipping");
    }
  }

  return atlasMap;
}

/**
 * Inventaire des .riv : ne lance le processus d'inspection (runtime Rive) que
 * si un fichier est à (ré)inspecter ; sinon l'inventaire est rafraîchi sur
 * place (alias, bundles), sans rien charger.
 */
async function syncRiveInventoryStep({ baseUrl, forceRive = false } = {}) {
  const pending = await listRiveFilesToInspect({ baseUrl, force: forceRive });
  if (!pending.length) return syncRiveInventory({ baseUrl, force: false });

  logger.info(
    { files: pending.map((file) => file.key), forceRive },
    "Inspecting Rive files in a child process"
  );
  return runSyncTask(
    "riveInventory",
    { baseUrl, force: forceRive },
    { timeoutMs: RIVE_INVENTORY_TIMEOUT }
  );
}

/**
 * Re-render the pet sprites from the game's Rive file when it changed.
 *
 * Les pets ne sont plus dans les atlas TexturePacker (seuls les œufs y
 * restent) : ils vivent dans `rive/pets.riv` et, pour les pets d'événement,
 * dans des fichiers à part (`halloween-pets.riv`), servis sous des URL
 * versionnées par hash. La comparaison d'atlas ne peut donc rien dire à leur
 * sujet — on suit ces fichiers séparément, sinon un changement d'artwork de
 * pet passerait inaperçu (ou pire, on re-rendrait 30 artboards à chaque sync).
 *
 * `forceRive` est le seul moyen de sauter la comparaison d'URL. La resync qui
 * suit une mise à jour du jeu ne le pose pas. Elle transmettait jusqu'ici son
 * `force` (destiné aux atlas) au rendu Rive, qui refaisait les mêmes `.riv` à
 * chaque version — ~36 s de WASM bloquant la boucle d'événements, puis ~54 min
 * d'animations, 7 fois entre le 17 et le 21/10 sur des fichiers identiques.
 *
 * @returns {Promise<{ exported: number, changed: boolean, riveUrls?: string[], reason?: string }>}
 */
async function syncPetSprites({ baseUrl, forceRive = false } = {}) {
  try {
    const files = await resolvePetsRiveFiles({ baseUrl });
    const riveUrls = files.map((f) => f.url);
    const stored = await loadStoredRiveAssets();
    const plan = planPetSprites({
      files,
      stored,
      sidecarExists: await fileExists(riveSidecarPath("pets")),
      forceRive,
    });

    if (!plan.render) {
      logger.debug({ riveUrls, reason: plan.reason }, "Pet sprite export not needed");
      return { exported: 0, changed: false, riveUrls, reason: plan.reason };
    }

    logger.info(
      { changed: plan.changed, reason: plan.reason },
      "Exporting pet sprites from Rive"
    );

    // Tous les fichiers sont re-rendus ensemble : le sidecar des frames est
    // réécrit d'un bloc, un export partiel y perdrait les autres espèces.
    // Hors de l'API : ~36 s de WASM synchrone qui bloquaient sa boucle.
    const result = await runSyncTask(
      "petSprites",
      { outDir: config.sprites.exportDir, riveUrls },
      { timeoutMs: PET_SPRITES_TIMEOUT }
    );
    clearRiveFramesCache();

    if (result.exported > 0) {
      for (const file of files) {
        const names = result.files.find((f) => f.url === file.url)?.names ?? [];
        await saveRiveAsset(file.key, { url: file.url, names });
      }
    }

    return { exported: result.exported, changed: result.exported > 0, riveUrls };
  } catch (err) {
    // Un échec de rendu Rive ne doit pas faire tomber la sync des atlas :
    // les PNG de pets déjà sur disque restent servis.
    logger.error(
      { error: err?.message || String(err) },
      "Failed to export pet sprites from Rive"
    );
    return { exported: 0, changed: false, reason: "error" };
  }
}

/**
 * Images fixes des décors que les atlas ne fournissent pas.
 *
 * Elles dépendent de `decor.riv` et des atlas (le PNG officiel prime) : on ne
 * les refait que si l'un des deux a pu bouger. Jusqu'ici cet export tournait à
 * chaque sync, démarrages compris, et rechargeait `decor.riv` dans le runtime
 * WASM pour n'en tirer, le plus souvent, aucune image.
 */
async function syncDecorSprites({ baseUrl, versionChanged, forceRive = false } = {}) {
  const currentUrl = await resolveRiveUrl("decor", { baseUrl });
  const stored = await loadStoredRiveAssets();
  const plan = planDecorSprites({
    versionChanged,
    currentUrl,
    storedUrl: stored.decor?.url ?? null,
    sidecarExists: await fileExists(riveSidecarPath("decor")),
    forceRive,
  });

  if (!plan.render) {
    logger.debug({ riveUrl: currentUrl, reason: plan.reason }, "Decor sprite export not needed");
    return { exported: 0, reason: plan.reason };
  }

  // Borné dans le temps : dans un processus déjà chaud, cet export ne se
  // terminait plus (5 fois entre le 17 et le 21/10) et gelait la suite de la
  // sync jusqu'au délai de garde. L'ancien `Promise.race` rendait la main sans
  // arrêter le travail ; le fils, lui, est tué.
  try {
    const result = await runSyncTask(
      "decorSprites",
      { outDir: config.sprites.exportDir, riveUrl: currentUrl },
      { timeoutMs: DECOR_EXPORT_TIMEOUT }
    );
    clearRiveFramesCache();
    await saveRiveAsset("decor", { url: currentUrl, names: result.names ?? [] });
    return { exported: result.exported, reason: plan.reason };
  } catch (err) {
    logger.error({ error: err?.message || String(err) }, "Decor sprite export failed");
    return { exported: 0, reason: "error" };
  }
}

/**
 * Check if sprites need syncing and export only changed sprites.
 * Returns sync result or null if no changes needed.
 */
export async function checkAndSyncSprites({
  force = false,
  forceRive = config.rive.forceRerender,
} = {}) {
  if (isSyncing) {
    logger.warn("Sprite sync already in progress, ignoring duplicate request");
    return null;
  }

  isSyncing = true;

  const timeout = setTimeout(() => {
    logger.error("Sprite sync timeout after 5 minutes, forcing exit");
    killSyncTasks();
    process.exit(1);
  }, SYNC_TIMEOUT);

  try {
    // 1. Check version
    const currentVersion = await fetchGameVersion();
    if (!currentVersion) {
      logger.error("Failed to fetch current game version");
      return null;
    }

    const storedVersion = await loadStoredVersion();
    const versionChanged = storedVersion !== currentVersion;

    logger.info(
      { currentVersion, storedVersion, versionChanged, force, forceRive },
      "Version check"
    );

    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      logger.error("Failed to get base URL");
      return null;
    }

    // 2. Rive : hors atlas depuis que le jeu y a passé les pets. Ces fichiers
    // ont leur propre suivi (URL versionnée par hash du .riv), donc on les
    // traite avant tous les court-circuits ci-dessous — sinon un déploiement
    // sur une install déjà synchronisée n'exporterait jamais les pets, faute de
    // montée de version. Le `force` des atlas ne les concerne pas : seul
    // `forceRive` saute la comparaison d'URL.
    // 2a. Inventaire de tous les .riv du manifest (10 fichiers). Peu coûteux :
    // chaque entrée est indexée par son URL, donc seuls les fichiers qui ont
    // réellement changé sont réinspectés.
    await syncRiveInventoryStep({ baseUrl, forceRive }).catch((err) =>
      logger.error({ error: err?.message || String(err) }, "Rive inventory sync failed")
    );

    const petResult = await syncPetSprites({ baseUrl, forceRive });

    // 2a bis. Images fixes des décors que les atlas ne fournissent pas. Fait
    // avant les court-circuits ci-dessous, pour la même raison que les pets.
    await syncDecorSprites({ baseUrl, versionChanged, forceRive });

    // 2b. Animations de pets : même source (`rive/pets.riv`), mais des minutes
    // de rendu — donc un processus fils, qu'on ne suit pas. Les boucles déjà
    // sur disque restent servies pendant la regénération.
    await syncPetAnimations({ riveUrls: petResult.riveUrls ?? [], force: forceRive });

    // 3. Skip the atlas work if version unchanged and not forced
    if (!versionChanged && !force) {
      logger.info(
        { petsExported: petResult.exported },
        "Version unchanged, skipping atlas sprite sync"
      );
      return {
        skipped: !petResult.changed,
        success: petResult.changed || undefined,
        reason: "version_unchanged",
        petsExported: petResult.exported,
      };
    }

    logger.info({ baseUrl }, "Fetching atlas metadata for comparison");
    const currentAtlases = await fetchAllAtlases(baseUrl);

    // 4. Load stored atlas metadata
    const storedAtlases = await loadStoredAtlases();

    // 5. Compare atlases
    const comparison = compareAllAtlases(currentAtlases, storedAtlases);

    logger.info(
      {
        hasChanges: comparison.hasChanges,
        summary: comparison.summary,
        framesToExport: comparison.framesToExport.size,
      },
      "Atlas comparison result"
    );

    // 6. If no atlas changes and not forced, skip the atlas export. Les pets
    // ont déjà été traités à l'étape 2, donc on remonte quand même leur
    // résultat.
    if (!comparison.hasChanges && !force) {
      logger.info(
        { petsExported: petResult.exported },
        "No atlas sprite changes detected, updating version only"
      );
      await saveVersion(currentVersion);
      return {
        skipped: !petResult.changed,
        success: petResult.changed || undefined,
        reason: "no_sprite_changes",
        versionUpdated: true,
        petsExported: petResult.exported,
      };
    }

    // 6b. If forced but no changes, do full export (initial export case)
    const doFullExport = force && !comparison.hasChanges;

    // 7. Export sprites (full or selective)
    if (doFullExport) {
      logger.info({ exportDir: config.sprites.exportDir }, "Starting FULL sprite export (initial)");
    } else {
      logger.info(
        {
          framesToExport: comparison.framesToExport.size,
          added: comparison.summary.totalAdded,
          modified: comparison.summary.totalModified,
          removed: comparison.summary.totalRemoved,
        },
        "Starting selective sprite export"
      );
    }

    // Dans un processus fils : chaque atlas décodé pèse jusqu'à 64 Mo, et le
    // même export, qui prend 35 s dans un processus neuf, ne rendait plus la
    // main dans l'API après quelques heures d'uptime.
    const startTime = Date.now();
    const exportResult = await runSyncTask(
      "atlasSprites",
      {
        outDir: config.sprites.exportDir,
        restoreTrim: true,
        onlyKeys: doFullExport ? null : [...comparison.framesToExport],
      },
      { timeoutMs: ATLAS_EXPORT_TIMEOUT }
    );

    const elapsed = Date.now() - startTime;

    // 8. Update stored metadata
    await updateStoredAtlases(comparison.atlasChanges);
    await saveVersion(currentVersion);

    logger.info(
      {
        exported: exportResult.exported,
        atlases: exportResult.atlases,
        outDir: exportResult.outDir,
        elapsedMs: elapsed,
        added: comparison.summary.totalAdded,
        modified: comparison.summary.totalModified,
        removed: comparison.summary.totalRemoved,
        petsExported: petResult.exported,
      },
      "Selective sprite export completed"
    );

    return {
      success: true,
      exported: exportResult.exported,
      petsExported: petResult.exported,
      added: comparison.summary.totalAdded,
      modified: comparison.summary.totalModified,
      removed: comparison.summary.totalRemoved,
      elapsed,
    };
  } catch (error) {
    logger.error(
      { error: error?.message || String(error) },
      "Sprite sync failed"
    );
    return { error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
    isSyncing = false;

    if (pendingForceResync) {
      pendingForceResync = false;
      logger.info("Running deferred forced sprite resync (game update arrived mid-sync)");
      runForcedResync().catch((err) =>
        logger.error({ error: err?.message || String(err) }, "Deferred forced resync failed")
      );
    }
  }
}

/**
 * Runs a forced resync after a game update.
 *
 * Every cache we hold is keyed by game version (bundle URL, asset base URL,
 * manifest), so they heal on their own — but a restart guarantees a clean state
 * and pm2 brings the process straight back, which is the behavior this API has
 * always had on a game update. Set VERSION_WATCH_RESTART=false to invalidate the
 * caches in place instead and keep the SSE streams alive.
 */
async function runForcedResync() {
  const result = await checkAndSyncSprites({ force: true });

  if (!result?.success && !result?.skipped) return;

  if (config.versionWatch.restartAfterSync) {
    logger.info("Sprite sync completed, restarting server in 1 second...");
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    return;
  }

  invalidateAllCaches();
  logger.info("Sprite sync completed, caches invalidated (restart disabled)");
}

/**
 * Handle a detected game update: full export, then restart.
 */
async function handleGameUpdate() {
  if (isSyncing) {
    // A sync is already running. Don't drop this request: checkAndSyncSprites'
    // finally block will pick it up once that sync ends.
    logger.warn("Sprite sync already in progress, deferring forced resync until it completes");
    pendingForceResync = true;
    return;
  }

  await runForcedResync();
}

/**
 * Check sprites at startup.
 * Forces full export if sprites directory is missing or empty.
 */
export async function checkSpritesOnStartup() {
  logger.info("Checking sprites on startup...");

  // Check if we need initial export (directory missing or empty)
  const forceExport = await needsInitialExport();
  if (forceExport) {
    logger.info({ exportDir: config.sprites.exportDir }, "Sprites directory missing or empty - forcing full export");
  }

  const result = await checkAndSyncSprites({ force: forceExport });

  if (result?.success) {
    logger.info(
      { exported: result.exported, added: result.added, modified: result.modified },
      "Sprites synced on startup"
    );
  }

  return result;
}

/**
 * Poll the game version and resync assets when it changes.
 *
 * Replaces the WebSocket close codes 4700/4710 (VERSION_MISMATCH /
 * VERSION_EXPIRED), which used to be how we learned about a game update: the
 * official API exposes the version directly, so we no longer need to hold a game
 * connection open just to be told it went stale.
 */
export function startVersionWatcher() {
  if (versionWatchTimer) return;

  if (!config.versionWatch.enabled) {
    logger.warn("Version watcher disabled - sprites will not follow game updates");
    return;
  }

  const interval = config.versionWatch.interval;
  logger.info({ interval }, "Version watcher started - polling for game updates");

  // Sync at startup, then watch for changes.
  checkSpritesOnStartup()
    .catch((err) => logger.error({ error: err?.message }, "Error checking sprites on startup"))
    .finally(async () => {
      watchedVersion = await loadStoredVersion().catch(() => null);
      versionWatchTimer = setInterval(checkVersion, interval);
    });
}

async function checkVersion() {
  try {
    invalidateVersionCache();

    const latestVersion = await fetchGameVersion();
    if (!latestVersion) return;

    // La version stockée est la référence : c'est celle sur laquelle nos
    // sprites/atlas sur disque ont été produits.
    const previousVersion = (await loadStoredVersion()) || watchedVersion;
    if (!previousVersion) {
      watchedVersion = latestVersion;
      return;
    }

    if (latestVersion === previousVersion) return;

    logger.warn(
      { from: previousVersion, to: latestVersion },
      "GAME UPDATE DETECTED - Triggering sprite sync"
    );
    watchedVersion = latestVersion;

    await handleGameUpdate();
  } catch (err) {
    logger.error({ error: err?.message || String(err) }, "Version check failed");
  }
}

export function stopVersionWatcher() {
  if (versionWatchTimer) clearInterval(versionWatchTimer);
  versionWatchTimer = null;
  killSyncTasks();
}
