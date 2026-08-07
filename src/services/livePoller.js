// src/services/livePoller.js

import { EventEmitter } from "node:events";

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import {
  fetchLiveState,
  normalizeShops,
  normalizeWeather,
  shopSignature,
  withRestockCountdown,
} from "../core/platform/index.js";

/**
 * Alimente les données live (shops + météo) depuis l'API officielle du jeu.
 *
 * Remplace la connexion WebSocket au jeu : on n'a plus besoin de rejoindre une
 * room pour lire le shop, donc plus de room à faire tourner à chaque mise à
 * jour, plus de codes de fermeture à interpréter, et plus de patches JSON
 * incrémentaux à appliquer à un état local.
 *
 * Événements :
 * - `shops`   (shops)            — un shop a réellement changé
 * - `weather` (label, details)   — la météo a changé
 */
const emitter = new EventEmitter();
// Chaque connexion SSE s'abonne : la limite par défaut (10) déclencherait un
// avertissement de fuite dès le 11e client.
emitter.setMaxListeners(0);

// Marge après `nextRestockAt` avant d'aller regarder en amont : le restock est
// atomique côté jeu, mais la réponse est servie via Cloudflare.
const RESTOCK_WAKE_MARGIN = 1000;

// Nombre max de polls rapprochés en attendant qu'un restock annoncé apparaisse
// réellement en amont. Au-delà, retour à la cadence de base (l'échéance était
// peut-être erronée) pour ne pas marteler l'API officielle.
const MAX_FAST_POLLS = 12;

let shops = null; // normalisé, sans compte à rebours (voir shops.js)
let shopsRaw = null; // payload officiel brut, par type de shop
let shopsSig = null;
let weatherLabel = null;
let weatherDetails = null;

let timer = null;
let started = false;
let fastPolls = 0;
let failures = 0;

const stats = {
  startedAt: null,
  polls: 0,
  failures: 0,
  lastPollAt: null,
  lastSuccessAt: null,
  lastShopsChangeAt: null,
  lastWeatherChangeAt: null,
  lastError: null,
};

/**
 * Signature de l'ensemble des shops, indépendante du temps.
 */
function signatureOf(allShops) {
  return Object.keys(allShops)
    .sort()
    .map((type) => `${type}${shopSignature(allShops[type])}`)
    .join(";;");
}

/**
 * Applique un payload shops et émet si quelque chose a bougé.
 */
function applyShops(payload) {
  const normalized = normalizeShops(payload);

  // Payload illisible : on garde l'état précédent plutôt que de publier des
  // shops vides — un shop vide est interprété comme une fermeture par les
  // consommateurs, et comme un non-évènement par l'historique.
  if (!normalized) {
    logger.warn("Platform shops payload unusable, keeping previous shops state");
    return;
  }

  shops = normalized;
  shopsRaw = payload?.shops ?? payload;

  const sig = signatureOf(normalized);
  if (sig === shopsSig) return;

  shopsSig = sig;
  stats.lastShopsChangeAt = new Date().toISOString();
  emitter.emit("shops", withRestockCountdown(normalized));
}

/**
 * Applique un payload météo et émet si elle a changé.
 */
function applyWeather(payload) {
  const details = normalizeWeather(payload);

  // Forme inattendue (normalizeWeather a déjà loggé) : on ne remplace pas une
  // météo connue par une supposition.
  if (!details.weather) return;

  if (details.weather === weatherLabel) {
    weatherDetails = details;
    return;
  }

  weatherLabel = details.weather;
  weatherDetails = details;
  stats.lastWeatherChangeAt = new Date().toISOString();
  emitter.emit("weather", weatherLabel, details);
}

/**
 * Un tour de polling.
 */
async function pollOnce() {
  stats.polls += 1;
  stats.lastPollAt = new Date().toISOString();

  const { shops: shopsPayload, weather: weatherPayload, shopsError, weatherError } =
    await fetchLiveState();

  // `weatherPayload` vaut null aussi bien pour « pas d'évènement météo » que
  // pour un échec réseau : sans ce garde-fou, une coupure passerait pour un
  // retour au beau temps et polluerait l'historique.
  if (!weatherError) applyWeather(weatherPayload);
  if (!shopsError) applyShops(shopsPayload);

  if (shopsError && weatherError) {
    failures += 1;
    stats.failures += 1;
    stats.lastError = shopsError?.message ?? String(shopsError);
    return;
  }

  failures = 0;
  stats.lastSuccessAt = new Date().toISOString();
}

/**
 * Prochaine échéance de restock connue, toutes boutiques confondues.
 */
function soonestRestockAt() {
  if (!shops) return null;

  let soonest = null;
  for (const shop of Object.values(shops)) {
    if (!shop.nextRestockAt) continue;
    const at = Date.parse(shop.nextRestockAt);
    if (!Number.isFinite(at)) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  return soonest;
}

/**
 * Délai avant le prochain poll.
 *
 * Cadence de base volontairement calme (l'API officielle est cachée 30 s), mais
 * on se réveille pile sur l'échéance de restock annoncée : le shop `seed`
 * tournant toutes les 5 minutes sur la même grille que les changements de
 * météo, ça couvre les deux transitions sans polling serré en continu.
 */
function computeDelay() {
  const { pollInterval, fastPollInterval, maxBackoff } = config.platform;

  if (failures > 0) {
    return Math.min(pollInterval * 2 ** Math.min(failures - 1, 5), maxBackoff);
  }

  const dueAt = soonestRestockAt();
  if (dueAt === null) return pollInterval;

  const untilDue = dueAt - Date.now();

  if (untilDue > 0) {
    fastPolls = 0;
    return Math.min(pollInterval, untilDue + RESTOCK_WAKE_MARGIN);
  }

  // Échéance dépassée mais restock pas encore visible en amont : on resserre.
  if (fastPolls < MAX_FAST_POLLS) {
    fastPolls += 1;
    return fastPollInterval;
  }

  return pollInterval;
}

function scheduleNext() {
  if (!started) return;
  timer = setTimeout(run, computeDelay());
}

function run() {
  pollOnce()
    .catch((err) => {
      failures += 1;
      stats.failures += 1;
      stats.lastError = err?.message ?? String(err);
      logger.error({ error: stats.lastError }, "Live poll failed");
    })
    .finally(scheduleNext);
}

/**
 * Démarre le polling. Le premier tour est immédiat.
 */
export function startLivePoller() {
  if (started) return;

  started = true;
  stats.startedAt = new Date().toISOString();

  logger.info(
    { pollInterval: config.platform.pollInterval, origin: config.game.origin },
    "Live poller started (official platform API)"
  );

  run();
}

export function stopLivePoller() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/**
 * Force un poll immédiat (hors cadence). Utile après une mise à jour du jeu.
 */
export async function pollLiveStateNow() {
  await pollOnce().catch((err) =>
    logger.error({ error: err?.message || String(err) }, "Forced live poll failed")
  );
}

// =====================
// Lecture d'état
// =====================

/** Shops avec `secondsUntilRestock` recalculé à la lecture. */
export function getShops() {
  return withRestockCountdown(shops);
}

/** Payload officiel brut, par type de shop. */
export function getShopsRaw() {
  return shopsRaw;
}

/** Libellé météo courant (ex. `Rain`, `Clear Skies`). */
export function getWeather() {
  return weatherLabel;
}

/** Météo courante détaillée (`startedAt`/`endsAt` si l'API les fournit). */
export function getWeatherDetails() {
  return weatherDetails;
}

export function getLiveStats() {
  return { ...stats, running: started };
}

export function onShopsChange(callback) {
  emitter.on("shops", callback);
  return () => emitter.off("shops", callback);
}

export function onWeatherChange(callback) {
  emitter.on("weather", callback);
  return () => emitter.off("weather", callback);
}
