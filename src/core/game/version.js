// src/core/game/version.js

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";

const VERSION_PATH = "/platform/v1/version";

let pendingPromise = null;
let cachedVersion = null;
let cachedAt = 0;
const VERSION_CACHE_TTL = 60 * 1000; // 1 min

/**
 * Récupère la version du jeu depuis l'API Magic Garden.
 * Cache la version pendant 1 minute pour éviter les requêtes répétées.
 */
export async function fetchGameVersion({ origin = config.game.origin } = {}) {
  // Retourne le cache si encore valide
  const now = Date.now();
  if (cachedVersion && now - cachedAt < VERSION_CACHE_TTL) {
    return cachedVersion;
  }

  // Évite les requêtes concurrentes
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    try {
      const url = new URL(VERSION_PATH, origin).toString();

      logger.debug({ url }, "Fetching game version");

      const res = await fetch(url, {
        headers: { "User-Agent": "MG-API/1.0" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`Version fetch failed (${res.status})`);
      }

      const data = await res.json();
      const version = typeof data?.version === "string" ? data.version.trim() : "";

      if (!version) {
        throw new Error("Version not found in response");
      }

      logger.info({ version }, "Game version fetched");

      cachedVersion = version;
      cachedAt = Date.now();

      return version;
    } finally {
      pendingPromise = null;
    }
  })();

  return pendingPromise;
}

/**
 * Invalide le cache de version.
 * Utile après une erreur de version mismatch.
 */
export function invalidateVersionCache() {
  cachedVersion = null;
  cachedAt = 0;
}
