// src/services/historyRecorder.js

import { logger } from "../logger/index.js";
import { liveDataService } from "./liveData.js";
import {
  initHistoryDB,
  recordShopRestock,
  recordWeatherChange,
  closeHistoryDB,
} from "./historyDB.js";

const SHOP_TYPES = ["seed", "tool", "egg", "decor", "dawn"];

const lastItemsHashByShop = new Map();
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

  for (const shopType of SHOP_TYPES) {
    const shop = slim[shopType];
    if (!shop || !Array.isArray(shop.items)) continue;

    const hash = hashItems(shop.items);
    const prev = lastItemsHashByShop.get(shopType);

    if (hash === prev) continue;

    const isBaseline = prev === undefined;
    lastItemsHashByShop.set(shopType, hash);

    if (isBaseline) {
      logger.debug({ shopType, itemCount: shop.items.length }, "History: shop baseline captured (not persisted)");
      continue;
    }

    // Track transition to empty in memory (so a later refill is detected as a real change),
    // but don't persist empty restocks — nothing to record.
    if (shop.items.length === 0) {
      logger.debug({ shopType }, "History: shop transitioned to empty (not persisted)");
      continue;
    }

    logger.info({ shopType, itemCount: shop.items.length }, "History: new shop restock");
    const items = shop.items.map((it) => ({ id: it.name, stock: it.stock }));

    try {
      recordShopRestock(shopType, items, shop.secondsUntilRestock || null, now);
    } catch (err) {
      logger.error({ err: err?.message, shopType }, "History: failed to record restock");
    }
  }
}

function handleWeather(weather) {
  if (!weather || typeof weather !== "string") return;

  if (lastWeatherObserved === null) {
    lastWeatherObserved = weather;
    logger.debug({ weather }, "History: weather baseline captured (not persisted)");
    return;
  }

  if (lastWeatherObserved === weather) return;
  lastWeatherObserved = weather;

  try {
    recordWeatherChange(weather, Date.now());
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
  lastWeatherObserved = null;
  closeHistoryDB();
  started = false;
}
