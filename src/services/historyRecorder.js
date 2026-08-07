// src/services/historyRecorder.js

import { logger } from "../logger/index.js";
import { liveDataService } from "./liveData.js";
import {
  initHistoryDB,
  recordShopRestock,
  recordWeatherChange,
  getLastRestockInterval,
  hasRestockNear,
  closeHistoryDB,
} from "./historyDB.js";
import { logShopEvent, logWeatherEvent } from "./eventLogger.js";
import { CLOCK_SKEW_MS, snapIfNearGrid, snapToGameGrid } from "../core/platform/grid.js";

/**
 * Intervalle maximal qu'on accepte pour reconstituer l'instant d'un restock à
 * partir de `nextRestockAt`.
 *
 * Le plus long cycle réel est celui du shop `decor` (1 h). Au-delà, l'intervalle
 * en base n'est pas un cycle : le shop `apology`, ouvert à la main par les
 * opérateurs du jeu, a ainsi laissé un « intervalle » de 85 374 s (~24 h) qui
 * antidaterait grossièrement sa réouverture. Dans ce cas on s'en tient à la
 * grille de 5 minutes.
 */
const MAX_DERIVABLE_INTERVAL_SECONDS = 60 * 60;

const lastWindowByShop = new Map(); // shopType -> { nextRestockAt: number|null, itemsHash: string }
let lastWeatherObserved = null;
let unsubShops = null;
let unsubWeather = null;
let started = false;

function hashItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((it) => `${it.name}:${it.stock}`)
    .sort()
    .join("|");
}

/**
 * Détermine l'instant exact du restock qu'on vient d'observer, et l'intervalle
 * de la boutique.
 *
 * @returns {{ restockedAt: number, intervalSeconds: number|null }}
 */
function resolveRestockWindow({ shopType, nextRestockAt, previous, now }) {
  // Cas normal : on avait déjà vu la fenêtre précédente. Son échéance *est*
  // l'instant du restock courant, et l'écart entre les deux échéances donne
  // l'intervalle — deux valeurs annoncées par le jeu, pas déduites du polling.
  if (previous?.nextRestockAt && nextRestockAt && nextRestockAt > previous.nextRestockAt) {
    return {
      restockedAt: previous.nextRestockAt,
      intervalSeconds: Math.round((nextRestockAt - previous.nextRestockAt) / 1000),
    };
  }

  // Premier passage (démarrage du process) ou boutique d'évènement qui vient
  // d'ouvrir : pas d'échéance précédente en mémoire. L'intervalle déjà connu en
  // base permet de remonter à l'instant du restock, ce qui fait que redémarrer
  // ne coûte plus une fenêtre de restock — l'insertion est idempotente
  // (index unique sur `shop_type, restocked_at`), donc la réenregistrer est
  // sans effet si elle est déjà là.
  const knownInterval = getLastRestockInterval(shopType);
  if (nextRestockAt && knownInterval && knownInterval <= MAX_DERIVABLE_INTERVAL_SECONDS) {
    // L'intervalle connu peut porter le bruit de l'ancien enregistreur (599 s
    // relevés pour un cycle réel de 600 s) : on recale sur la grille quand on en
    // est à une poignée de secondes, et on redéduit l'intervalle de là.
    const restockedAt = snapIfNearGrid(nextRestockAt - knownInterval * 1000);

    // Garde-fou : si la fenêtre déduite n'encadre pas l'instant présent, c'est
    // que l'intervalle a changé côté jeu. On retombe sur la grille plutôt que
    // d'écrire un horodatage faux.
    if (restockedAt <= now && now < nextRestockAt) {
      return {
        restockedAt,
        intervalSeconds: Math.round((nextRestockAt - restockedAt) / 1000),
      };
    }
  }

  return { restockedAt: snapToGameGrid(now), intervalSeconds: knownInterval ?? null };
}

function handleShops(shops) {
  if (!shops || typeof shops !== "object") return;
  const now = Date.now();

  // Itère sur tous les shops présents (pas de liste codée en dur) : un nouveau
  // shop ajouté par le jeu est enregistré automatiquement.
  for (const [shopType, shop] of Object.entries(shops)) {
    if (!shop || !Array.isArray(shop.items)) continue;

    const nextRestockAt = shop.nextRestockAt ? Date.parse(shop.nextRestockAt) : null;
    const itemsHash = hashItems(shop.items);
    const previous = lastWindowByShop.get(shopType);
    const isBaseline = previous === undefined;

    if (
      !isBaseline &&
      previous.nextRestockAt === nextRestockAt &&
      previous.itemsHash === itemsHash
    ) {
      continue;
    }

    lastWindowByShop.set(shopType, { nextRestockAt, itemsHash });

    const isEmpty = shop.items.length === 0;

    // Trace brute systématique, qu'on persiste ensuite ou non.
    logShopEvent({
      ts: now,
      shop_type: shopType,
      raw: liveDataService.getShopsRaw()?.[shopType] ?? null,
      slim: shop,
      baseline: isBaseline,
      empty: isEmpty,
    });

    // Boutique fermée ou vide : rien à enregistrer. L'état est mémorisé pour
    // qu'une réouverture soit bien vue comme un changement.
    if (isEmpty) {
      logger.debug({ shopType }, "History: shop empty/closed (not persisted)");
      continue;
    }

    // Même échéance de restock, contenu différent : par construction ce n'est
    // pas un restock, puisque c'est le jeu qui annonce les fenêtres. Ça
    // arriverait si `stock` devenait un stock vivant décrémenté par les achats
    // (aujourd'hui c'est le stock initial de la fenêtre, constant). On le trace
    // sans polluer l'historique des restocks.
    if (!isBaseline && previous.nextRestockAt !== null && previous.nextRestockAt === nextRestockAt) {
      logger.debug(
        { shopType },
        "History: shop content changed inside the same restock window (not persisted)"
      );
      continue;
    }

    const { restockedAt, intervalSeconds } = resolveRestockWindow({
      shopType,
      nextRestockAt,
      previous,
      now,
    });

    const items = shop.items.map((it) => ({ id: it.name, stock: it.stock }));

    // Fenêtre déjà en base à quelques secondes près (typiquement au démarrage,
    // ou juste après la bascule depuis l'enregistreur WebSocket qui horodatait
    // à l'observation) : ne pas la dupliquer.
    if (hasRestockNear(shopType, restockedAt)) {
      logger.debug(
        { shopType, restockedAt: new Date(restockedAt).toISOString() },
        "History: restock window already recorded, skipping"
      );
      continue;
    }

    try {
      const restockId = recordShopRestock(shopType, items, intervalSeconds, restockedAt);

      if (restockId === null) {
        logger.debug(
          { shopType, restockedAt },
          "History: restock already recorded (idempotent no-op)"
        );
      } else {
        logger.info(
          {
            shopType,
            itemCount: items.length,
            restockedAt: new Date(restockedAt).toISOString(),
            intervalSeconds,
            baseline: isBaseline,
          },
          "History: new shop restock"
        );
      }
    } catch (err) {
      logger.error({ err: err?.message, shopType }, "History: failed to record restock");
    }
  }
}

/**
 * Instant de début d'un évènement météo.
 *
 * On préfère l'horodatage annoncé par l'API officielle s'il existe, sinon la
 * grille de 5 minutes du jeu.
 */
function resolveWeatherStart(details, now) {
  const explicit = details?.startedAt ? Date.parse(details.startedAt) : NaN;
  if (Number.isFinite(explicit) && explicit <= now + CLOCK_SKEW_MS) return explicit;
  return snapToGameGrid(now);
}

function handleWeather(weather, details) {
  if (!weather || typeof weather !== "string") return;
  const now = Date.now();

  if (lastWeatherObserved === null) {
    lastWeatherObserved = weather;
    logWeatherEvent({ ts: now, weather, baseline: true });
    logger.debug({ weather }, "History: weather baseline captured (not persisted)");
    return;
  }

  if (lastWeatherObserved === weather) return;
  lastWeatherObserved = weather;

  const startedAt = resolveWeatherStart(details, now);
  logWeatherEvent({ ts: startedAt, weather, baseline: false });

  try {
    recordWeatherChange(weather, startedAt);
    logger.info(
      { weather, startedAt: new Date(startedAt).toISOString() },
      "History: weather change recorded"
    );
  } catch (err) {
    logger.error({ err: err?.message, weather }, "History: failed to record weather");
  }
}

export function startHistoryRecorder() {
  if (started) return;
  initHistoryDB();

  // Le poller peut n'avoir encore rien reçu au démarrage : dans ce cas le
  // premier évènement émis fera office de baseline.
  const initialShops = liveDataService.getShops();
  if (initialShops) handleShops(initialShops);

  const initialWeather = liveDataService.getWeather();
  if (initialWeather) handleWeather(initialWeather, liveDataService.getWeatherDetails());

  unsubShops = liveDataService.onShopsChange(handleShops);
  unsubWeather = liveDataService.onWeatherChange(handleWeather);

  started = true;
  logger.info("History recorder started");
}

export function stopHistoryRecorder() {
  if (!started) return;
  try { unsubShops?.(); } catch { /* ignore */ }
  try { unsubWeather?.(); } catch { /* ignore */ }
  unsubShops = null;
  unsubWeather = null;
  lastWindowByShop.clear();
  lastWeatherObserved = null;
  closeHistoryDB();
  started = false;
}
