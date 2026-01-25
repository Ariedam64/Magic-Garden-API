// src/core/game/atlasStorage.js

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../..", "data");
const ATLASES_FILE = path.join(DATA_DIR, "atlases.json");

/**
 * Ensure data directory exists.
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Already exists or permission error will be caught later
  }
}

/**
 * Generate a hash for frame data to detect modifications.
 * Includes position, size, rotation, trim info.
 */
function hashFrameData(frame) {
  const data = JSON.stringify({
    frame: frame?.frame || null,
    rotated: !!frame?.rotated,
    trimmed: !!frame?.trimmed,
    sourceSize: frame?.sourceSize || null,
    spriteSourceSize: frame?.spriteSourceSize || null,
    anchor: frame?.anchor || null,
  });
  return createHash("md5").update(data).digest("hex").slice(0, 12);
}

/**
 * Generate a hash for the entire atlas JSON.
 */
function hashAtlasJson(atlasJson) {
  const str = JSON.stringify(atlasJson);
  return createHash("sha256").update(str).digest("hex");
}

/**
 * Build atlas metadata from raw atlas JSON.
 */
export function buildAtlasMetadata(atlasJson, sourceJsonPath) {
  const frames = atlasJson?.frames || {};
  const frameKeys = Object.keys(frames);

  const frameData = {};
  for (const key of frameKeys) {
    frameData[key] = hashFrameData(frames[key]);
  }

  return {
    sourceJson: sourceJsonPath,
    hash: hashAtlasJson(atlasJson),
    frameCount: frameKeys.length,
    frames: frameData, // { "sprite/plant/Carrot": "abc123" }
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Load stored atlases metadata from disk.
 * Returns empty object if file doesn't exist (first run).
 */
export async function loadStoredAtlases() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(ATLASES_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      logger.debug("Atlases file not found (first run)");
      return {};
    }
    logger.warn({ error: err.message }, "Failed to load stored atlases");
    return {};
  }
}

/**
 * Save atlases metadata to disk.
 */
export async function saveAtlases(atlases) {
  try {
    await ensureDataDir();
    await fs.writeFile(ATLASES_FILE, JSON.stringify(atlases, null, 2));
    logger.info({ atlasCount: Object.keys(atlases).length }, "Atlases metadata saved");
  } catch (err) {
    logger.error({ error: err.message }, "Failed to save atlases metadata");
  }
}

/**
 * Compare a new atlas with stored metadata.
 * Returns detailed diff: added, modified, removed frames.
 */
export function compareAtlas(newMetadata, storedMetadata) {
  // No stored data = everything is new
  if (!storedMetadata) {
    return {
      changed: true,
      isNew: true,
      hashChanged: true,
      added: Object.keys(newMetadata.frames),
      modified: [],
      removed: [],
    };
  }

  // Quick check: hash identical = no changes
  if (newMetadata.hash === storedMetadata.hash) {
    return {
      changed: false,
      isNew: false,
      hashChanged: false,
      added: [],
      modified: [],
      removed: [],
    };
  }

  // Hash different: compare frame by frame
  const newFrames = newMetadata.frames;
  const oldFrames = storedMetadata.frames || {};

  const added = [];
  const modified = [];
  const removed = [];

  // Check for added and modified frames
  for (const key of Object.keys(newFrames)) {
    if (!(key in oldFrames)) {
      added.push(key);
    } else if (newFrames[key] !== oldFrames[key]) {
      modified.push(key);
    }
  }

  // Check for removed frames
  for (const key of Object.keys(oldFrames)) {
    if (!(key in newFrames)) {
      removed.push(key);
    }
  }

  const changed = added.length > 0 || modified.length > 0 || removed.length > 0;

  return {
    changed,
    isNew: false,
    hashChanged: true,
    added,
    modified,
    removed,
  };
}

/**
 * Compare multiple atlases and aggregate changes.
 *
 * @param {Object} newAtlasesMap - Map of sourceJson -> atlasJson
 * @param {Object} storedAtlases - Stored metadata from disk
 * @returns {Object} Aggregated diff with frames to export
 */
export function compareAllAtlases(newAtlasesMap, storedAtlases) {
  const results = {
    hasChanges: false,
    atlasChanges: {},
    framesToExport: new Set(), // Frame keys to export
    removedFrames: new Set(),
    summary: {
      totalAdded: 0,
      totalModified: 0,
      totalRemoved: 0,
      atlasesChanged: 0,
      atlasesUnchanged: 0,
    },
  };

  for (const [sourceJson, atlasJson] of Object.entries(newAtlasesMap)) {
    const newMeta = buildAtlasMetadata(atlasJson, sourceJson);
    const storedMeta = storedAtlases[sourceJson];
    const diff = compareAtlas(newMeta, storedMeta);

    results.atlasChanges[sourceJson] = {
      newMeta,
      diff,
    };

    if (diff.changed) {
      results.hasChanges = true;
      results.summary.atlasesChanged++;
      results.summary.totalAdded += diff.added.length;
      results.summary.totalModified += diff.modified.length;
      results.summary.totalRemoved += diff.removed.length;

      // Add frames to export
      for (const key of diff.added) {
        results.framesToExport.add(key);
      }
      for (const key of diff.modified) {
        results.framesToExport.add(key);
      }
      for (const key of diff.removed) {
        results.removedFrames.add(key);
      }
    } else {
      results.summary.atlasesUnchanged++;
    }
  }

  return results;
}

/**
 * Update stored atlases after successful export.
 * Only updates metadata for atlases that were processed.
 */
export async function updateStoredAtlases(atlasChanges) {
  const stored = await loadStoredAtlases();

  for (const [sourceJson, { newMeta }] of Object.entries(atlasChanges)) {
    stored[sourceJson] = newMeta;
  }

  await saveAtlases(stored);
  return stored;
}
