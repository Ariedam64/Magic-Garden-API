// src/core/platform/client.js

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";

export const SHOPS_PATH = "/platform/v1/shops";
export const WEATHER_PATH = "/platform/v1/weather";

/**
 * GET d'une ressource JSON de l'API officielle du jeu (`/platform/v1/*`).
 *
 * Ces endpoints répondent en `public, max-age=30` côté Cloudflare : inutile de
 * les interroger plus vite que ça pour espérer des données plus fraîches (voir
 * `config.platform.pollInterval`).
 */
async function getJson(path, { origin = config.game.origin, timeout = config.platform.timeout } = {}) {
  const url = new URL(path, origin).toString();

  const res = await fetch(url, {
    headers: {
      "User-Agent": config.platform.userAgent,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    throw new Error(`Platform request failed (${res.status}) for ${path}`);
  }

  return res.json();
}

/**
 * État courant de tous les shops.
 * @returns {Promise<object>} `{ shops: { seed: {...}, egg: {...}, ... } }`
 */
export function fetchShops(options = {}) {
  return getJson(SHOPS_PATH, options);
}

/**
 * Météo courante.
 *
 * Renvoie `null` quand aucun évènement météo n'est actif (= Clear Skies) :
 * c'est une réponse valide, pas une erreur. Voir `normalizeWeather`.
 */
export function fetchWeather(options = {}) {
  return getJson(WEATHER_PATH, options);
}

/**
 * Récupère shops + météo en parallèle.
 *
 * Les deux requêtes sont indépendantes : un échec d'un côté ne doit pas priver
 * l'autre de sa mise à jour, donc on renvoie les erreurs plutôt que de rejeter.
 * @returns {Promise<{ shops: object|null, weather: unknown, shopsError: Error|null, weatherError: Error|null }>}
 */
export async function fetchLiveState(options = {}) {
  const [shopsResult, weatherResult] = await Promise.allSettled([
    fetchShops(options),
    fetchWeather(options),
  ]);

  if (shopsResult.status === "rejected") {
    logger.warn({ error: shopsResult.reason?.message }, "Platform shops fetch failed");
  }
  if (weatherResult.status === "rejected") {
    logger.warn({ error: weatherResult.reason?.message }, "Platform weather fetch failed");
  }

  return {
    shops: shopsResult.status === "fulfilled" ? shopsResult.value : null,
    weather: weatherResult.status === "fulfilled" ? weatherResult.value : null,
    shopsError: shopsResult.status === "rejected" ? shopsResult.reason : null,
    weatherError: weatherResult.status === "rejected" ? weatherResult.reason : null,
  };
}
