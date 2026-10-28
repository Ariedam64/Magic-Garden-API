// src/core/game/versionStorage.js

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../..", "data");
const VERSION_FILE = path.join(DATA_DIR, "version.json");
const STORED_VERSION_TTL = 60 * 1000; // 1 min

let cachedStored = null;
let cachedStoredAt = 0;

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
 * Lit `version.json`, ou null (premier démarrage, fichier illisible).
 */
async function readVersionFile() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(VERSION_FILE, "utf-8");
    return JSON.parse(content);
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
 * Load stored game version from disk.
 * Returns null if file doesn't exist (first run).
 */
export async function loadStoredVersion() {
  return (await readVersionFile())?.version || null;
}

/**
 * Version et révision des assets stockées, avec un court cache mémoire.
 */
async function getStoredCached() {
  const now = Date.now();
  if (cachedStored && now - cachedStoredAt < STORED_VERSION_TTL) {
    return cachedStored;
  }

  const data = await readVersionFile();
  if (!data?.version) return null;

  cachedStored = { version: data.version, assetRevision: Number(data.assetRevision) || 0 };
  cachedStoredAt = now;
  return cachedStored;
}

/**
 * Load stored version with a short in-memory cache.
 */
export async function getStoredVersionCached() {
  return (await getStoredCached())?.version ?? null;
}

/**
 * Révision des assets après l'enregistrement de `version`.
 *
 * Réenregistrer la version déjà stockée, c'est que les fichiers viennent
 * d'être réécrits pour elle : la révision avance, pour que les URL changent.
 * Une nouvelle version repart de 0.
 */
export function nextAssetRevision(previous, version) {
  return previous?.version === version ? (Number(previous.assetRevision) || 0) + 1 : 0;
}

/**
 * `?v=` d'une version stockée : `1778`, ou `1778-r1` une fois les fichiers
 * régénérés pour la même version.
 */
export function assetVersionToken(stored) {
  if (!stored?.version) return null;
  const revision = Number(stored.assetRevision) || 0;
  return revision > 0 ? `${stored.version}-r${revision}` : stored.version;
}

/**
 * Jeton de cache des fichiers servis (`?v=` des URL de sprites et
 * d'animations, cache de `/data`, ETag des compositions).
 *
 * Nginx sert ces fichiers `immutable` pendant un an : une URL ne doit donc
 * changer de contenu qu'en changeant de `?v=`. La version du jeu ne suffit
 * pas, car les fichiers peuvent être régénérés sans mise à jour du jeu. La
 * révision s'ajoute alors à la version (`1778-r1`) ; à 0, le jeton reste la
 * version seule, comme avant.
 */
export async function getAssetVersionCached() {
  return assetVersionToken(await getStoredCached());
}

/**
 * Save game version to disk, with its asset revision (`nextAssetRevision`).
 */
export async function saveVersion(version) {
  try {
    await ensureDataDir();
    const next = String(version).trim();
    const previous = await readVersionFile();
    const assetRevision = nextAssetRevision(previous, next);
    const data = {
      version: next,
      assetRevision,
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(VERSION_FILE, JSON.stringify(data, null, 2));
    cachedStored = { version: data.version, assetRevision };
    cachedStoredAt = Date.now();
    logger.info({ version: data.version, assetRevision }, "Version saved");
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
