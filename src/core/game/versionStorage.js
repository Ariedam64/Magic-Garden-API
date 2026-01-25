// src/core/game/versionStorage.js

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../..", "data");
const VERSION_FILE = path.join(DATA_DIR, "version.json");

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
 * Load stored game version from disk.
 * Returns null if file doesn't exist (first run).
 */
export async function loadStoredVersion() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(VERSION_FILE, "utf-8");
    const data = JSON.parse(content);
    return data.version || null;
  } catch (err) {
    if (err.code === "ENOENT") {
      logger.debug("Version file not found (first run)");
      return null;
    }
    logger.warn({ error: err.message }, "Failed to load stored version");
    return null;
  }
}

/**
 * Save game version to disk.
 */
export async function saveVersion(version) {
  try {
    await ensureDataDir();
    const data = {
      version: String(version).trim(),
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(VERSION_FILE, JSON.stringify(data, null, 2));
    logger.info({ version: data.version }, "Version saved");
  } catch (err) {
    logger.error({ error: err.message }, "Failed to save version");
  }
}

/**
 * Check if game version has changed compared to stored version.
 * Saves new version if changed.
 */
export async function getVersionChanged(currentVersion) {
  const stored = await loadStoredVersion();
  const changed = stored !== currentVersion;

  if (changed && currentVersion) {
    await saveVersion(currentVersion);
    logger.warn({ from: stored, to: currentVersion }, "Game version changed");
  }

  return changed;
}
