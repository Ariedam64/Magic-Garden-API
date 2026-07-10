// src/services/historyRecorder.js

import { logger } from "../logger/index.js";
import { liveDataService } from "./liveData.js";
import {
  initHistoryDB,
  recordShopRestock,
  recordWeatherChange,
  closeHistoryDB,
} from "./historyDB.js";
import { logShopEvent, logWeatherEvent } from "./eventLogger.js";

const lastItemsHashByShop = new Map();
// Last *non-empty* content seen per shop, used to recognize a WebSocket
// disconnect/reconnect blip (shop briefly reports empty items, then the same
// content reappears a second or two later) as a continuation of the same
// restock window rather than a brand new one. See handleShops() below.
const lastRealRestockByShop = new Map(); // shopType -> { hash, interval, ts }
let lastWeatherObserved = null;
let unsubShops = null;
let unsubWeather = null;
let started = false;

function hashItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const parts = items
    .map((it) => `${it.name}:${it.stock}`)
    .sort();
  return parts.join("|");
}

function handleShops(slim) {
  if (!slim || typeof slim !== "object") return;
  const now = Date.now();

  // Itère sur tous les shops présents (pas de liste codée en dur) : un nouveau
  // shop comme `snow` est enregistré automatiquement.
  for (const [shopType, shop] of Object.entries(slim)) {
    if (!shop || !Array.isArray(shop.items)) continue;

    const hash = hashItems(shop.items);
    const prev = lastItemsHashByShop.get(shopType);

    if (hash === prev) continue;

    const isBaseline = prev === undefined;
    const isEmpty = shop.items.length === 0;
    lastItemsHashByShop.set(shopType, hash);

    // Always log the raw event for safety, regardless of whether it's persisted to DB.
    const rawShops = liveDataService.getShopsRaw();
    logShopEvent({
      ts: now,
      shop_type: shopType,
      raw: rawShops?.[shopType] ?? null,
      slim: shop,
      baseline: isBaseline,
      empty: isEmpty,
    });

    if (isBaseline) {
      logger.debug({ shopType, itemCount: shop.items.length }, "History: shop baseline captured (not persisted)");
      if (!isEmpty) {
        lastRealRestockByShop.set(shopType, { hash, interval: shop.secondsUntilRestock || null, ts: now });
      }
      continue;
    }

    // Track transition to empty in memory (so a later refill is detected as a real change),
    // but don't persist empty restocks — nothing to record. Deliberately leave
    // lastRealRestockByShop untouched: the game WebSocket sometimes relays a
    // momentary empty patch (disconnect/reconnect blip) for these ephemeral
    // event shops, and we still need the pre-blip content/countdown below to
    // recognize the reappearance as the same window, not a fresh restock.
    if (isEmpty) {
      logger.debug({ shopType }, "History: shop transitioned to empty (not persisted)");
      continue;
    }

    const restockInterval = shop.secondsUntilRestock || null;
    const lastReal = lastRealRestockByShop.get(shopType);
    let isReconnectBlip = false;
    if (lastReal && lastReal.hash === hash && restockInterval != null && lastReal.interval != null) {
      const elapsedSeconds = (now - lastReal.ts) / 1000;
      const expectedInterval = lastReal.interval - elapsedSeconds;
      // Same items + the restock countdown simply kept ticking down (rather
      // than resetting near its max) ⇒ this is the same shop window
      // reappearing after a transient empty blip, not a genuine new restock.
      isReconnectBlip = Math.abs(restockInterval - expectedInterval) < 15;
    }

    if (isReconnectBlip) {
      logger.info({ shopType, restockInterval }, "History: ignoring reconnect blip (same restock window, not persisted)");
      // Don't touch lastRealRestockByShop — it still describes this same window.
      continue;
    }

    logger.info({ shopType, itemCount: shop.items.length }, "History: new shop restock");
    const items = shop.items.map((it) => ({ id: it.name, stock: it.stock }));
    lastRealRestockByShop.set(shopType, { hash, interval: restockInterval, ts: now });

    try {
      recordShopRestock(shopType, items, restockInterval, now);
    } catch (err) {
      logger.error({ err: err?.message, shopType }, "History: failed to record restock");
    }
  }
}

function handleWeather(weather) {
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
  logWeatherEvent({ ts: now, weather, baseline: false });

  try {
    recordWeatherChange(weather, now);
    logger.info({ weather }, "History: weather change recorded");
  } catch (err) {
    logger.error({ err: err?.message, weather }, "History: failed to record weather");
  }
}

export function startHistoryRecorder() {
  if (started) return;
  initHistoryDB();

  const initialShops = liveDataService.getShops();
  if (initialShops) handleShops(initialShops);

  const initialWeather = liveDataService.getWeather();
  if (initialWeather) handleWeather(initialWeather);

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
  lastItemsHashByShop.clear();
  lastRealRestockByShop.clear();
  lastWeatherObserved = null;
  closeHistoryDB();
  started = false;
}
