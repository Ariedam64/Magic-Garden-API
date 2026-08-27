// src/services/spriteSync.js

import fs from "node:fs/promises";
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
import { exportSpritesToDisk } from "../assets/sprites/exportSpritesToDisk.js";
import {
  exportPetsFromRive,
  resolvePetsRiveUrl,
} from "../assets/sprites/exportPetsFromRive.js";
import { exportDecorFromRive } from "../assets/sprites/exportDecorFromRive.js";
import { getStoredRiveUrl, saveRiveAsset } from "../core/game/riveStorage.js";
import { syncPetAnimations } from "./animationSync.js";
import { syncRiveInventory } from "./riveSync.js";
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

// Marge large : une resync complète forcée (30 artboards Rive rasterisés +
// ~575 sprites redécoupés des atlas) tourne autour de 2 min, et le rendu Rive
// grandit avec le nombre de pets que le jeu ajoute. Ce timeout est un
// garde-fou contre une sync bloquée (il tue le process), pas une cible de
// perf : le fixer trop juste transformerait une grosse maj du jeu en
// redémarrage en boucle.
const SYNC_TIMEOUT = 15 * 60 * 1000; // 15 minutes

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
 * Re-render the pet sprites from the game's Rive file when it changed.
 *
 * Les pets ne sont plus dans les atlas TexturePacker (seuls les œufs y
 * restent) : ils vivent dans `rive/pets.riv`, servi sous une URL versionnée
 * par hash. La comparaison d'atlas ne peut donc rien dire à leur sujet — on
 * suit ce fichier séparément, sinon un changement d'artwork de pet passerait
 * inaperçu (ou pire, on re-rendrait 30 artboards à chaque sync).
 *
 * @returns {Promise<{ exported: number, changed: boolean, riveUrl?: string, reason?: string }>}
 */
async function syncPetSprites({ baseUrl, force = false } = {}) {
  try {
    const riveUrl = await resolvePetsRiveUrl(baseUrl);
    if (!riveUrl) {
      return { exported: 0, changed: false, reason: "rive_not_in_manifest" };
    }

    const storedUrl = await getStoredRiveUrl("pets");
    if (!force && storedUrl === riveUrl) {
      logger.debug({ riveUrl }, "Pets Rive file unchanged, skipping pet sprite export");
      return { exported: 0, changed: false, riveUrl, reason: "unchanged" };
    }

    logger.info({ from: storedUrl, to: riveUrl, force }, "Exporting pet sprites from Rive");

    const result = await exportPetsFromRive({
      outDir: config.sprites.exportDir,
      riveUrl,
    });

    if (result.exported > 0) {
      await saveRiveAsset("pets", { url: riveUrl, names: result.names });
    }

    return { exported: result.exported, changed: result.exported > 0, riveUrl };
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
 * Check if sprites need syncing and export only changed sprites.
 * Returns sync result or null if no changes needed.
 */
export async function checkAndSyncSprites({ force = false } = {}) {
  if (isSyncing) {
    logger.warn("Sprite sync already in progress, ignoring duplicate request");
    return null;
  }

  isSyncing = true;

  const timeout = setTimeout(() => {
    logger.error("Sprite sync timeout after 5 minutes, forcing exit");
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
      { currentVersion, storedVersion, versionChanged, force },
      "Version check"
    );

    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      logger.error("Failed to get base URL");
      return null;
    }

    // 2. Pets : hors atlas depuis que le jeu les a passés en Rive. Ils ont
    // leur propre suivi (hash du .riv), donc on les traite avant tous les
    // court-circuits ci-dessous — sinon un déploiement sur une install déjà
    // synchronisée n'exporterait jamais les pets, faute de montée de version.
    // 2a. Inventaire de tous les .riv du manifest (6 fichiers, 5 bundles). Peu
    // coûteux : chaque entrée est indexée par une URL versionnée par hash, donc
    // seuls les fichiers qui ont réellement changé sont réinspectés.
    await syncRiveInventory({ baseUrl, force }).catch((err) =>
      logger.error({ error: err?.message || String(err) }, "Rive inventory sync failed")
    );

    const petResult = await syncPetSprites({ baseUrl, force });

    // 2a bis. Images fixes des décors que les atlas ne fournissent pas. Deux
    // artboards aujourd'hui, donc quelques secondes : on le fait avant les
    // court-circuits ci-dessous, sinon un déploiement sur une install déjà
    // synchronisée ne les exporterait jamais.
    await exportDecorFromRive({ outDir: config.sprites.exportDir }).catch((err) =>
      logger.error({ error: err?.message || String(err) }, "Decor sprite export failed")
    );

    // 2b. Animations de pets : même source (`rive/pets.riv`), mais des minutes
    // de rendu — donc un processus fils, qu'on ne suit pas. Les boucles déjà
    // sur disque restent servies pendant la regénération.
    await syncPetAnimations({ riveUrl: petResult.riveUrl ?? null, force });

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

    const startTime = Date.now();
    const exportResult = await exportSpritesToDisk({
      outDir: config.sprites.exportDir,
      restoreTrim: true,
      onlyKeys: doFullExport ? null : comparison.framesToExport,
    });

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
}
