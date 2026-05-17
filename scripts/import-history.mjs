// scripts/import-history.mjs
//
// Import historical shop restocks and weather events from external JSON exports
// into the SQLite history DB.
//
// Modes:
//   --mode=merge   (default) Idempotent. Existing rows are kept; duplicates are
//                  skipped via INSERT OR IGNORE on the (shop_type, restocked_at)
//                  and weather started_at unique indexes. Safe to run repeatedly.
//   --mode=wipe    DESTRUCTIVE. Deletes all rows in shop_restocks, shop_restock_items
//                  and weather_events before reimporting. Asks for confirmation
//                  (type DROP) unless --force is passed.
//
// Usage:
//   pm2 stop mg-api
//   node scripts/import-history.mjs                       # merge (default)
//   node scripts/import-history.mjs --mode=wipe           # wipe with prompt
//   node scripts/import-history.mjs --mode=wipe --force   # wipe without prompt
//   pm2 start mg-api

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RESTOCKS_PATH = path.join(ROOT, "export/export-restock-full.json");
const WEATHER_PATH = path.join(ROOT, "export/export-weather-events.json");
const DB_PATH = path.join(ROOT, "data/history.sqlite");

// Schema kept in sync with src/services/historyDB.js
const SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_restocks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_type                TEXT    NOT NULL,
  restocked_at             INTEGER NOT NULL,
  restock_interval_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS idx_restocks_type_time
  ON shop_restocks(shop_type, restocked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_restocks_type_time
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
CREATE UNIQUE INDEX IF NOT EXISTS uniq_weather_started
  ON weather_events(started_at);
`;

// Mirror src/core/parsers/weather.js formatWeather to keep imported names consistent.
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

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mode: "merge", force: false };
  for (const a of args) {
    if (a === "--force") opts.force = true;
    else if (a.startsWith("--mode=")) opts.mode = a.slice(7);
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node scripts/import-history.mjs [--mode=merge|wipe] [--force]");
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!["merge", "wipe"].includes(opts.mode)) {
    console.error(`--mode must be 'merge' or 'wipe' (got '${opts.mode}')`);
    process.exit(2);
  }
  return opts;
}

async function promptConfirmation(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const opts = parseArgs();

  console.log(`DB:      ${DB_PATH}`);
  console.log(`Mode:    ${opts.mode}${opts.force ? " (forced)" : ""}`);
  console.log(`Loading: ${RESTOCKS_PATH}`);
  console.log(`Loading: ${WEATHER_PATH}`);
  const restocksData = JSON.parse(fs.readFileSync(RESTOCKS_PATH, "utf8"));
  const weatherData = JSON.parse(fs.readFileSync(WEATHER_PATH, "utf8"));

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // =====================
  // WIPE mode (destructive, asks for confirmation)
  // =====================
  if (opts.mode === "wipe") {
    const counts = {
      restocks: db.prepare("SELECT COUNT(*) AS n FROM shop_restocks").get().n,
      items: db.prepare("SELECT COUNT(*) AS n FROM shop_restock_items").get().n,
      weather: db.prepare("SELECT COUNT(*) AS n FROM weather_events").get().n,
    };
    console.log(`\nAbout to DELETE ${fmtNum(counts.restocks)} restocks, ${fmtNum(counts.items)} items, ${fmtNum(counts.weather)} weather events.`);

    if (!opts.force) {
      if (!process.stdin.isTTY) {
        console.error("Refusing to wipe in non-interactive mode. Pass --force to override.");
        process.exit(1);
      }
      const answer = await promptConfirmation("Type DROP to confirm (anything else aborts): ");
      if (answer !== "DROP") {
        console.error("Aborted.");
        process.exit(1);
      }
    }

    console.log("Wiping...");
    db.exec(`
      DELETE FROM shop_restock_items;
      DELETE FROM shop_restocks;
      DELETE FROM weather_events;
      DELETE FROM sqlite_sequence WHERE name IN ('shop_restocks','weather_events');
    `);
  }

  // Both modes use INSERT OR IGNORE so they're safe to re-run.
  const insertRestock = db.prepare(`
    INSERT OR IGNORE INTO shop_restocks (shop_type, restocked_at, restock_interval_seconds)
    VALUES (?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT OR IGNORE INTO shop_restock_items (restock_id, item_id, stock)
    VALUES (?, ?, ?)
  `);
  const insertWeather = db.prepare(`
    INSERT OR IGNORE INTO weather_events (weather, started_at, ended_at)
    VALUES (?, ?, ?)
  `);
  // For the very last weather event we want to keep it open (ended_at = NULL) only
  // if no row already exists for that started_at. INSERT OR IGNORE handles that.

  // =====================
  // SHOPS
  // =====================
  console.log("\nImporting shop restocks...");
  const t0 = Date.now();

  const importShops = db.transaction(() => {
    let totalRestocksInserted = 0;
    let totalRestocksSkipped = 0;
    let totalItemsInserted = 0;
    let totalItemsSkipped = 0;

    for (const [shopType, arr] of Object.entries(restocksData)) {
      let shopRestocksInserted = 0;
      let shopRestocksSkipped = 0;
      let shopItemsInserted = 0;
      let shopItemsSkipped = 0;

      for (const restock of arr) {
        if (typeof restock?.timestamp !== "number") continue;
        const info = insertRestock.run(shopType, restock.timestamp, null);

        if (info.changes === 0) {
          // Restock already exists: skip its items too (keeping existing item set).
          shopRestocksSkipped += 1;
          continue;
        }

        const restockId = info.lastInsertRowid;
        shopRestocksInserted += 1;

        const items = Array.isArray(restock.items) ? restock.items : [];
        for (const itemStr of items) {
          if (!itemStr) continue;
          const { id, stock } = parseItemString(itemStr);
          if (!id || !Number.isFinite(stock) || stock < 0) {
            shopItemsSkipped += 1;
            continue;
          }
          const r = insertItem.run(restockId, id, stock);
          if (r.changes === 1) shopItemsInserted += 1;
          else shopItemsSkipped += 1;
        }
      }

      console.log(
        `  ${shopType.padEnd(6)}  ` +
        `inserted=${fmtNum(shopRestocksInserted).padStart(7)} restocks ` +
        `(${fmtNum(shopItemsInserted).padStart(8)} items)  ` +
        `skipped=${fmtNum(shopRestocksSkipped).padStart(7)} restocks ` +
        `(${fmtNum(shopItemsSkipped).padStart(4)} items)`
      );
      totalRestocksInserted += shopRestocksInserted;
      totalRestocksSkipped += shopRestocksSkipped;
      totalItemsInserted += shopItemsInserted;
      totalItemsSkipped += shopItemsSkipped;
    }

    console.log(
      `  ${"TOTAL".padEnd(6)}  ` +
      `inserted=${fmtNum(totalRestocksInserted).padStart(7)} restocks ` +
      `(${fmtNum(totalItemsInserted).padStart(8)} items)  ` +
      `skipped=${fmtNum(totalRestocksSkipped).padStart(7)} restocks ` +
      `(${fmtNum(totalItemsSkipped).padStart(4)} items)`
    );
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
    let skipped = 0;
    let collapsed = 0;

    let cursor = null;
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const formatted = formatWeather(cur.weather);

      if (cursor && cursor.weather === formatted) {
        collapsed += 1;
        continue;
      }

      if (cursor) {
        const info = insertWeather.run(cursor.weather, cursor.started_at, cur.timestamp);
        if (info.changes === 1) inserted += 1;
        else skipped += 1;
      }
      cursor = { weather: formatted, started_at: cur.timestamp };
    }
    // Final row stays open (ended_at = NULL). If a row with the same started_at
    // already exists (e.g. live recorder later inserted one), INSERT OR IGNORE keeps
    // the existing one untouched.
    if (cursor) {
      const info = insertWeather.run(cursor.weather, cursor.started_at, null);
      if (info.changes === 1) inserted += 1;
      else skipped += 1;
    }

    console.log(`  inserted=${fmtNum(inserted)}  skipped=${fmtNum(skipped)}  collapsed=${fmtNum(collapsed)}`);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
