// scripts/import-history.mjs
//
// One-shot import of historical shop restocks and weather events from external
// JSON exports into the SQLite history DB. Wipes the existing DB tables.
//
// Usage (with pm2 stopped to avoid races):
//   pm2 stop mg-api
//   node scripts/import-history.mjs
//   pm2 start mg-api

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RESTOCKS_PATH = path.join(ROOT, "export/export-restock-full.json");
const WEATHER_PATH = path.join(ROOT, "export/export-weather-events.json");
const DB_PATH = path.join(ROOT, "data/history.sqlite");

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

// Mirror src/core/parsers/weather.js formatWeather to keep the imported names
// consistent with what the live recorder writes.
function formatWeather(value) {
  if (value == null) return "Clear Skies";
  const raw = String(value).trim();
  if (!raw) return "Clear Skies";
  switch (raw.toLowerCase()) {
    case "sunny": return "Clear Skies";
    case "rain": return "Rain";
    case "frost": return "Snow";
    case "snow": return "Snow";
    case "amber moon":
    case "ambermoon": return "Amber Moon";
    case "dawn": return "Dawn";
    case "thunderstorm": return "Thunderstorm";
    default: return raw;
  }
}

// Old in-game seed names that were renamed by the devs. The Discord bot kept
// the old names, so we normalize at import time to match the current game IDs.
const ITEM_ID_ALIASES = {
  Dawnbinder: "DawnCelestial",
  Moonbinder: "MoonCelestial",
};

// "Carrot x18" -> { id: "Carrot", stock: 18 }
// "Strawberry" -> { id: "Strawberry", stock: 1 }
const ITEM_RE = /^(.+?)\s+x(\d+)$/;
function parseItemString(s) {
  const m = ITEM_RE.exec(s);
  const rawId = m ? m[1] : String(s).trim();
  const stock = m ? Number(m[2]) : 1;
  const id = ITEM_ID_ALIASES[rawId] ?? rawId;
  return { id, stock };
}

function fmtNum(n) {
  return n.toLocaleString("en-US");
}

function main() {
  console.log(`DB:      ${DB_PATH}`);
  console.log(`Loading: ${RESTOCKS_PATH}`);
  console.log(`Loading: ${WEATHER_PATH}`);
  const restocksData = JSON.parse(fs.readFileSync(RESTOCKS_PATH, "utf8"));
  const weatherData = JSON.parse(fs.readFileSync(WEATHER_PATH, "utf8"));

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  console.log("\nWiping existing rows...");
  db.exec(`
    DELETE FROM shop_restock_items;
    DELETE FROM shop_restocks;
    DELETE FROM weather_events;
    DELETE FROM sqlite_sequence WHERE name IN ('shop_restocks','weather_events');
  `);

  const insertRestock = db.prepare(`
    INSERT INTO shop_restocks (shop_type, restocked_at, restock_interval_seconds)
    VALUES (?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO shop_restock_items (restock_id, item_id, stock)
    VALUES (?, ?, ?)
  `);
  const insertWeather = db.prepare(`
    INSERT INTO weather_events (weather, started_at, ended_at)
    VALUES (?, ?, ?)
  `);

  // =====================
  // SHOPS
  // =====================
  console.log("\nImporting shop restocks...");
  const t0 = Date.now();

  const importShops = db.transaction(() => {
    let totalRestocks = 0;
    let totalItems = 0;
    let skippedItems = 0;

    for (const [shopType, arr] of Object.entries(restocksData)) {
      let shopRestocks = 0;
      let shopItems = 0;

      for (const restock of arr) {
        if (typeof restock?.timestamp !== "number") continue;
        const info = insertRestock.run(shopType, restock.timestamp, null);
        const restockId = info.lastInsertRowid;
        shopRestocks += 1;

        const items = Array.isArray(restock.items) ? restock.items : [];
        for (const itemStr of items) {
          if (!itemStr) continue;
          const { id, stock } = parseItemString(itemStr);
          if (!id || !Number.isFinite(stock) || stock < 0) {
            skippedItems += 1;
            continue;
          }
          const r = insertItem.run(restockId, id, stock);
          if (r.changes === 1) shopItems += 1;
          else skippedItems += 1; // dup item in same restock
        }
      }

      console.log(`  ${shopType.padEnd(6)}  ${fmtNum(shopRestocks).padStart(8)} restocks  ${fmtNum(shopItems).padStart(10)} items`);
      totalRestocks += shopRestocks;
      totalItems += shopItems;
    }

    console.log(`  ${"TOTAL".padEnd(6)}  ${fmtNum(totalRestocks).padStart(8)} restocks  ${fmtNum(totalItems).padStart(10)} items  (skipped ${skippedItems})`);
  });
  importShops();

  // =====================
  // WEATHER
  // =====================
  console.log("\nImporting weather events...");
  const sorted = weatherData
    .filter((w) => typeof w?.timestamp === "number" && w?.weather)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const importWeather = db.transaction(() => {
    let inserted = 0;
    let collapsed = 0;

    // Collapse consecutive same-weather events into a single row spanning their union
    let cursor = null;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const formatted = formatWeather(cur.weather);

      if (cursor && cursor.weather === formatted) {
        // Same weather continues; extend end implicitly via the next event's timestamp
        collapsed += 1;
        continue;
      }

      // Flush previous cursor with ended_at = cur.timestamp
      if (cursor) {
        insertWeather.run(cursor.weather, cursor.started_at, cur.timestamp);
        inserted += 1;
      }
      cursor = { weather: formatted, started_at: cur.timestamp };
    }
    // Final row stays open (ended_at = NULL) — matches the live recorder convention
    if (cursor) {
      insertWeather.run(cursor.weather, cursor.started_at, null);
      inserted += 1;
    }

    console.log(`  inserted ${fmtNum(inserted)} weather events (collapsed ${fmtNum(collapsed)} consecutive duplicates)`);
  });
  importWeather();

  // =====================
  // Summary
  // =====================
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\nFinished in ${elapsed}s`);
  console.log("\nFinal counts:");
  for (const row of db.prepare("SELECT shop_type, COUNT(*) AS n FROM shop_restocks GROUP BY shop_type").all()) {
    console.log(`  shop_restocks.${row.shop_type.padEnd(6)} = ${fmtNum(row.n)}`);
  }
  const itemsTotal = db.prepare("SELECT COUNT(*) AS n FROM shop_restock_items").get().n;
  console.log(`  shop_restock_items.* = ${fmtNum(itemsTotal)}`);
  const weatherTotal = db.prepare("SELECT COUNT(*) AS n FROM weather_events").get().n;
  console.log(`  weather_events.*     = ${fmtNum(weatherTotal)}`);

  db.close();
  console.log("\nDone.");
}

main();
