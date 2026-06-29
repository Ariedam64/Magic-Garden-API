// scripts/backfill-weather.mjs
//
// Backfill the weather_events SQLite table from the deterministic schedule
// engine ported from the game's client bundle. The game never transmits weather
// over the WebSocket — clients compute it locally from a per-UTC-day seed — so
// the history table has been empty since the recorder started. This script
// rebuilds it from any historical date.
//
// Idempotent thanks to UNIQUE(started_at) on weather_events: re-runs only
// insert events that don't exist yet.
//
// Usage:
//   node scripts/backfill-weather.mjs                                 # 2026-02-01 -> today UTC
//   node scripts/backfill-weather.mjs --from=2026-02-01 --to=2026-06-28
//   node scripts/backfill-weather.mjs --dry-run                        # no writes
//   node scripts/backfill-weather.mjs --db=./data/history.sqlite
//
// Stop the API first if it's running so the DB isn't locked:
//   pm2 stop mg-api && node scripts/backfill-weather.mjs && pm2 start mg-api

import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { eventsInRange, DISPLAY } from "../src/core/weather/schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DB = path.join(ROOT, "data/history.sqlite");
const DEFAULT_FROM = "2026-02-01";

function parseArgs(argv) {
  const args = { from: DEFAULT_FROM, to: null, db: DEFAULT_DB, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--from=")) args.from = a.slice(7);
    else if (a.startsWith("--to=")) args.to = a.slice(5);
    else if (a.startsWith("--db=")) args.db = a.slice(5);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function utcDateMs(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) throw new Error(`Invalid date: ${yyyyMmDd} (expected YYYY-MM-DD)`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function todayUtcKey() {
  return new Date().toISOString().slice(0, 10);
}

const args = parseArgs(process.argv);
const toKey = args.to || todayUtcKey();
const fromMs = utcDateMs(args.from);
const toMs = utcDateMs(toKey); // exclusive upper bound (midnight UTC of `to`)

if (toMs <= fromMs) {
  console.error(`--to (${toKey}) must be strictly after --from (${args.from})`);
  process.exit(2);
}

console.log(`[backfill-weather] Range: ${args.from} -> ${toKey} (UTC), ${(toMs - fromMs) / 86_400_000} day(s)`);
console.log(`[backfill-weather] DB: ${args.db}${args.dryRun ? "  (DRY RUN)" : ""}`);

console.log(`[backfill-weather] Generating deterministic events...`);
const events = eventsInRange(fromMs, toMs);
console.log(`[backfill-weather] Generated ${events.length} events.`);

const byType = {};
for (const e of events) byType[e.display] = (byType[e.display] || 0) + 1;
console.log(`[backfill-weather] Breakdown:`);
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(15)} ${String(v).padStart(6)}`);
}

if (args.dryRun) {
  console.log(`[backfill-weather] Dry-run done. First 5 events:`);
  for (const e of events.slice(0, 5)) {
    console.log(`  ${new Date(e.startedAt).toISOString()}  ${e.display.padEnd(15)} ${e.durationMin}min`);
  }
  process.exit(0);
}

const db = new Database(args.db);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Ensure the weather table exists (matches src/services/historyDB.js schema).
db.exec(`
CREATE TABLE IF NOT EXISTS weather_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weather    TEXT    NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_weather_started ON weather_events(started_at);
CREATE INDEX IF NOT EXISTS idx_weather_type    ON weather_events(weather, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_weather_started ON weather_events(started_at);
`);

const insert = db.prepare(`
  INSERT OR IGNORE INTO weather_events (weather, started_at, ended_at)
  VALUES (?, ?, ?)
`);

let inserted = 0;
let skipped = 0;

const tx = db.transaction((rows) => {
  for (const e of rows) {
    const info = insert.run(e.display, e.startedAt, e.endedAt);
    if (info.changes === 1) inserted += 1; else skipped += 1;
  }
});

const BATCH = 5000;
for (let i = 0; i < events.length; i += BATCH) {
  tx(events.slice(i, i + BATCH));
}

const total = db.prepare(`SELECT COUNT(*) AS n FROM weather_events`).get().n;
const totalInRange = db.prepare(`
  SELECT COUNT(*) AS n FROM weather_events
  WHERE started_at >= ? AND started_at < ?
`).get(fromMs, toMs).n;

db.close();

console.log(`[backfill-weather] Done.`);
console.log(`  Inserted:           ${inserted}`);
console.log(`  Skipped (existed):  ${skipped}`);
console.log(`  Total in range now: ${totalInRange}`);
console.log(`  Total in table now: ${total}`);
