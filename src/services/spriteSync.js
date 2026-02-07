// src/services/spriteSync.js

import fs from "node:fs/promises";
import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import { CloseCodes } from "../core/websocket/closeCodes.js";
import { fetchGameVersion, invalidateVersionCache } from "../core/game/version.js";
import { loadStoredVersion, saveVersion } from "../core/game/versionStorage.js";
import {
  loadStoredAtlases,
  compareAllAtlases,
  updateStoredAtlases,
} from "../core/game/atlasStorage.js";
import { getBaseUrl } from "../assets/assets.js";
import { loadManifest, getBundleByName, extractJsonFiles } from "../assets/manifest.js";
import { exportSpritesToDisk } from "../assets/sprites/exportSpritesToDisk.js";
import { joinUrl } from "../utils/url.js";

const VERSION_MISMATCH_CODES = new Set([CloseCodes.VERSION_MISMATCH, CloseCodes.VERSION_EXPIRED]);

let isSyncing = false;
const SYNC_TIMEOUT = 5 * 60 * 1000; // 5 minutes

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
 * Check for version change after a WebSocket disconnect and sync if needed.
 */
async function checkSpritesAfterDisconnect(mgConnection, { code, reason } = {}) {
  try {
    invalidateVersionCache();

    const latestVersion = await fetchGameVersion({ origin: mgConnection?.origin });
    const previousVersion = (await loadStoredVersion()) || mgConnection?.version;

    if (!latestVersion || !previousVersion) {
      logger.debug(
        { latestVersion, previousVersion, code, reason },
        "Skipping sprite sync check after disconnect (missing version)"
      );
      return;
    }

    if (latestVersion === previousVersion) {
      logger.debug(
        { latestVersion, previousVersion, code, reason },
        "Game version unchanged after disconnect, skipping sprite sync"
      );
      return;
    }

    logger.warn(
      { from: previousVersion, to: latestVersion, code, reason },
      "Game version changed after disconnect, syncing sprites"
    );

    await checkAndSyncSprites({ force: false });
  } catch (err) {
    logger.error({ error: err?.message || String(err), code, reason }, "Failed version check after disconnect");
  }
}

/**
 * Extract all asset source files from a bundle.
 */
function extractAllSources(bundle) {
  if (!bundle || !Array.isArray(bundle.assets)) return [];

  const sources = new Set();
  for (const asset of bundle.assets) {
    const srcs = Array.isArray(asset?.src) ? asset.src : [];
    for (const src of srcs) {
      if (typeof src === "string") {
        sources.add(src);
      }
    }
  }
  return Array.from(sources);
}

/**
 * Fetch all atlas JSON files from the game server.
 * Returns a map of sourceJson -> atlasJson.
 * Also discovers JSON files for webp atlases not listed in manifest.
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

  // Also look for webp files and try to find corresponding JSON
  const allSources = extractAllSources(bundle);
  const webpFiles = allSources.filter(
    (f) => f.endsWith(".webp") && (f.includes("sprite") || f.includes("tiles") || f.includes("weather"))
  );

  // Add potential JSON files for webp atlases
  for (const webp of webpFiles) {
    const jsonFile = webp.replace(".webp", ".json");
    if (!atlasJsonFiles.has(jsonFile)) {
      atlasJsonFiles.add(jsonFile);
    }
  }

  logger.debug({ atlasFiles: Array.from(atlasJsonFiles) }, "Atlas files to fetch");

  const atlasMap = {};
  for (const jsonFile of atlasJsonFiles) {
    try {
      const url = joinUrl(baseUrl, jsonFile);
      const atlasJson = await fetchJson(url);
      atlasMap[jsonFile] = atlasJson;
      logger.debug({ jsonFile, frameCount: Object.keys(atlasJson?.frames || {}).length }, "Atlas loaded");
    } catch (err) {
      logger.warn({ jsonFile, error: err.message }, "Failed to fetch atlas, skipping");
    }
  }

  return atlasMap;
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

    // Skip if version unchanged and not forced
    if (!versionChanged && !force) {
      logger.info("Version unchanged, skipping sprite sync");
      return { skipped: true, reason: "version_unchanged" };
    }

    // 2. Fetch current atlases
    const baseUrl = await getBaseUrl();
    if (!baseUrl) {
      logger.error("Failed to get base URL");
      return null;
    }

    logger.info({ baseUrl }, "Fetching atlas metadata for comparison");
    const currentAtlases = await fetchAllAtlases(baseUrl);

    // 3. Load stored atlas metadata
    const storedAtlases = await loadStoredAtlases();

    // 4. Compare atlases
    const comparison = compareAllAtlases(currentAtlases, storedAtlases);

    logger.info(
      {
        hasChanges: comparison.hasChanges,
        summary: comparison.summary,
        framesToExport: comparison.framesToExport.size,
      },
      "Atlas comparison result"
    );

    // 5. If no changes and not forced, skip export
    if (!comparison.hasChanges && !force) {
      logger.info("No sprite changes detected, updating version only");
      await saveVersion(currentVersion);
      return {
        skipped: true,
        reason: "no_sprite_changes",
        versionUpdated: true,
      };
    }

    // 5b. If forced but no changes, do full export (initial export case)
    const doFullExport = force && !comparison.hasChanges;

    // 6. Export sprites (full or selective)
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

    // 7. Update stored metadata
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
      },
      "Selective sprite export completed"
    );

    return {
      success: true,
      exported: exportResult.exported,
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
  }
}

/**
 * Handle version mismatch (old behavior - full export + restart).
 * Kept for compatibility with WebSocket close codes.
 */
async function handleVersionMismatch() {
  const result = await checkAndSyncSprites({ force: true });

  if (result?.success || result?.skipped) {
    logger.info("Sprite sync completed, restarting server in 1 second...");
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  }
}

/**
 * Check sprites on connection open.
 * This is called when WebSocket connects successfully.
 * Forces full export if sprites directory is missing or empty.
 */
export async function checkSpritesOnConnect() {
  logger.info("Checking sprites on connection...");

  // Check if we need initial export (directory missing or empty)
  const forceExport = await needsInitialExport();
  if (forceExport) {
    logger.info({ exportDir: config.sprites.exportDir }, "Sprites directory missing or empty - forcing full export");
  }

  const result = await checkAndSyncSprites({ force: forceExport });

  if (result?.success) {
    logger.info(
      { exported: result.exported, added: result.added, modified: result.modified },
      "Sprites synced on connect"
    );
  }

  return result;
}

/**
 * Register listener for version mismatch close codes.
 * Also checks sprites on successful connection.
 */
export function registerSpriteSyncListener(mgConnection) {
  if (!mgConnection) {
    logger.warn("Invalid WebSocket connection, sprite sync listener not registered");
    return;
  }

  logger.info("Sprite sync listener registered - watching for version changes");

  // Check sprites when connection opens
  mgConnection.on("open", () => {
    logger.debug("WebSocket open event - triggering sprite check");
    checkSpritesOnConnect().catch((err) => {
      logger.error({ error: err?.message }, "Error checking sprites on connect");
    });
  });

  // Handle version mismatch on close
  mgConnection.on("close", ({ code, reason }) => {
    logger.debug({ code, reason }, "WebSocket close event received by sprite sync listener");

    if (VERSION_MISMATCH_CODES.has(code)) {
      const codeName = code === CloseCodes.VERSION_MISMATCH ? "VERSION_MISMATCH (4700)" : "VERSION_EXPIRED (4710)";
      logger.warn({ code, codeName, reason }, "VERSION MISMATCH DETECTED - Triggering sprite sync");

      handleVersionMismatch().catch((err) => {
        logger.error({ error: err?.message }, "Unexpected error in version mismatch handler");
      });
      return;
    }

    checkSpritesAfterDisconnect(mgConnection, { code, reason }).catch((err) => {
      logger.error({ error: err?.message }, "Unexpected error in disconnect version check");
    });
  });
}
