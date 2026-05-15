// src/services/historyDB.js

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_restocks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_type                TEXT    NOT NULL,
  restocked_at             INTEGER NOT NULL,
  restock_interval_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_restocks_type_time
  ON shop_restocks(shop_type, restocked_at);

CREATE TABLE IF NOT EXISTS shop_restock_items (
  restock_id INTEGER NOT NULL REFERENCES shop_restocks(id) ON DELETE CASCADE,
  item_id    TEXT    NOT NULL,
  stock      INTEGER NOT NULL,
  PRIMARY KEY (restock_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_restock_items_id
  ON shop_restock_items(item_id);

CREATE TABLE IF NOT EXISTS weather_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weather    TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_weather_started
  ON weather_events(started_at);
CREATE INDEX IF NOT EXISTS idx_weather_type
  ON weather_events(weather, started_at);
`;

let db = null;
let statements = null;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function initHistoryDB() {
  if (db) return db;

  const dbPath = config.history.dbPath;
  ensureDir(dbPath);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  statements = {
    insertRestock: db.prepare(`
      INSERT INTO shop_restocks (shop_type, restocked_at, restock_interval_seconds)
      VALUES (?, ?, ?)
    `),
    insertItem: db.prepare(`
      INSERT INTO shop_restock_items (restock_id, item_id, stock)
      VALUES (?, ?, ?)
    `),
    openWeather: db.prepare(`
      INSERT INTO weather_events (weather, started_at) VALUES (?, ?)
    `),
    closeOpenWeather: db.prepare(`
      UPDATE weather_events SET ended_at = ?
      WHERE ended_at IS NULL
    `),
    getCurrentWeather: db.prepare(`
      SELECT id, weather, started_at FROM weather_events
      WHERE ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    `),
  };

  const insertRestockWithItems = db.transaction(
    (shopType, restockedAt, intervalSeconds, items) => {
      const info = statements.insertRestock.run(
        shopType,
        restockedAt,
        intervalSeconds,
      );
      const restockId = info.lastInsertRowid;
      for (const it of items) {
        statements.insertItem.run(restockId, it.id, it.stock);
      }
      return restockId;
    },
  );

  const rotateWeather = db.transaction((nextWeather, ts) => {
    statements.closeOpenWeather.run(ts);
    statements.openWeather.run(nextWeather, ts);
  });

  db._tx = { insertRestockWithItems, rotateWeather };

  logger.info({ dbPath }, "History DB initialized");
  return db;
}

export function recordShopRestock(shopType, items, intervalSeconds = null, at = Date.now()) {
  if (!db) return null;
  return db._tx.insertRestockWithItems(shopType, at, intervalSeconds, items);
}

export function recordWeatherChange(nextWeather, at = Date.now()) {
  if (!db) return;
  const current = statements.getCurrentWeather.get();
  if (current && current.weather === nextWeather) return;
  db._tx.rotateWeather(nextWeather, at);
}

export function getDB() {
  return db;
}

export function closeHistoryDB() {
  if (!db) return;
  try {
    db.close();
  } catch {
    // ignore
  }
  db = null;
  statements = null;
}
