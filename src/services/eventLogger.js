// src/services/eventLogger.js
//
// Append-only NDJSON event logger. Acts as a raw safety net alongside the SQLite
// history DB: if the game changes its format and our parser/recorder breaks (or
// silently drops data), we still have every observed shop/weather transition on
// disk and can rebuild the DB from these files later.
//
// Files are rotated per UTC month:
//   data/events/shops-YYYY-MM.ndjson
//   data/events/weather-YYYY-MM.ndjson
//
// Each line is a self-contained JSON object terminated with `\n`.

import fs from "node:fs";
import path from "node:path";

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";

let ensuredDir = false;

function ensureDir() {
  if (ensuredDir) return;
  const dir = config.history.eventsDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ensuredDir = true;
}

function monthlyFile(prefix, ts) {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return path.join(config.history.eventsDir, `${prefix}-${yyyy}-${mm}.ndjson`);
}

function append(file, obj) {
  try {
    ensureDir();
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  } catch (err) {
    logger.error({ err: err?.message, file }, "Event logger: append failed");
  }
}

/**
 * Log a shop change event.
 * @param {object} ev
 * @param {number} ev.ts             Epoch ms at detection time.
 * @param {string} ev.shop_type      'seed'|'tool'|'egg'|'decor'|'dawn'.
 * @param {object|null} ev.raw       The raw shop object from the WS parser (full inventory).
 * @param {object} ev.slim           The simplified version we feed to the DB recorder.
 * @param {boolean} ev.baseline      True for the boot-time baseline (not persisted to DB).
 * @param {boolean} ev.empty         True when the shop transitioned to empty (not persisted to DB).
 */
export function logShopEvent(ev) {
  if (!config.history.eventsEnabled) return;
  append(monthlyFile("shops", ev.ts), ev);
}

/**
 * Log a weather change event.
 * @param {object} ev
 * @param {number} ev.ts             Epoch ms at detection time.
 * @param {string} ev.weather        Formatted weather name (post-normalization).
 * @param {boolean} ev.baseline      True for the boot-time baseline (not persisted to DB).
 */
export function logWeatherEvent(ev) {
  if (!config.history.eventsEnabled) return;
  append(monthlyFile("weather", ev.ts), ev);
}
