// src/core/game/riveStorage.js

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../..", "data");
const RIVE_FILE = path.join(DATA_DIR, "rive-assets.json");

/**
 * Suivi des assets Rive déjà exportés.
 *
 * Les .riv sont servis sous une URL versionnée par hash de contenu
 * (`/runtime-assets/pets.<hash>.riv`), donc mémoriser l'URL exportée suffit à
 * savoir si l'artwork a bougé — pas besoin de re-télécharger et re-rendre les
 * artboards à chaque montée de version du jeu.
 */

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Already exists or permission error will be caught later
  }
}

/**
 * @returns {Promise<Record<string, { url: string, names?: string[], lastUpdated?: string }>>}
 */
export async function loadStoredRiveAssets() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(RIVE_FILE, "utf-8");
    return JSON.parse(content) || {};
  } catch (err) {
    if (err.code === "ENOENT") {
      logger.debug("Rive assets file not found (first run)");
      return {};
    }
    logger.warn({ error: err.message }, "Failed to load stored Rive assets");
    return {};
  }
}

/**
 * Retourne l'URL exportée pour un asset Rive (ex: "pets"), ou null.
 */
export async function getStoredRiveUrl(assetKey) {
  const stored = await loadStoredRiveAssets();
  return stored[assetKey]?.url ?? null;
}

/**
 * Mémorise l'URL exportée d'un asset Rive.
 */
export async function saveRiveAsset(assetKey, { url, names = [] } = {}) {
  try {
    const stored = await loadStoredRiveAssets();
    stored[assetKey] = {
      url,
      names,
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(RIVE_FILE, JSON.stringify(stored, null, 2));
    logger.info({ assetKey, url, count: names.length }, "Rive asset export recorded");
  } catch (err) {
    logger.error({ assetKey, error: err.message }, "Failed to save Rive asset metadata");
  }
}
