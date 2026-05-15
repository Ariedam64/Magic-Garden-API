// src/services/historyQueries.js

import { getDB } from "./historyDB.js";

export const SHOP_TYPES = ["seed", "tool", "egg", "decor", "dawn"];
export const BUCKETS = ["hour", "day", "week"];

const MS = {
  hour: 3600_000,
  day: 86_400_000,
  week: 604_800_000,
};

const DEFAULT_RANGE_MS = 30 * MS.day;
const MAX_BUCKETS = 10_000;

export function parseTimestamp(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function resolveRange({ from, to } = {}) {
  const now = Date.now();
  const toTs = parseTimestamp(to) ?? now;
  const fromTs = parseTimestamp(from) ?? toTs - DEFAULT_RANGE_MS;
  if (fromTs >= toTs) {
    const err = new Error("`from` must be < `to`");
    err.code = "BAD_RANGE";
    throw err;
  }
  return { from: fromTs, to: toTs };
}

export function resolveBucket(bucket, { from, to }) {
  const b = bucket ? String(bucket).toLowerCase() : "day";
  if (!BUCKETS.includes(b)) {
    const err = new Error(`bucket must be one of ${BUCKETS.join(", ")}`);
    err.code = "BAD_BUCKET";
    throw err;
  }
  const ms = MS[b];
  const count = Math.ceil((to - from) / ms);
  if (count > MAX_BUCKETS) {
    const err = new Error(`Too many buckets (${count}). Use a wider bucket or smaller range.`);
    err.code = "TOO_MANY_BUCKETS";
    throw err;
  }
  return { bucket: b, ms };
}

export function validateShop(shop) {
  if (!SHOP_TYPES.includes(shop)) {
    const err = new Error(`shop must be one of ${SHOP_TYPES.join(", ")}`);
    err.code = "BAD_SHOP";
    throw err;
  }
  return shop;
}

function bucketStart(t, ms) {
  return Math.floor(t / ms) * ms;
}

function buildBuckets(from, to, ms) {
  const start = bucketStart(from, ms);
  const out = [];
  for (let t = start; t < to; t += ms) out.push(t);
  return out;
}

// =====================
// Items: timeseries
// =====================

export function queryItemsTimeseries({ shop, ids, from, to, bucket, bucketMs }) {
  const db = getDB();
  if (!db) return [];

  // total_restocks per bucket
  // CAST is required: better-sqlite3 binds JS numbers as REAL, so without the
  // cast the division returns a float and the bucket boundaries don't line up.
  const totalsRows = db.prepare(`
    SELECT CAST(restocked_at / ? AS INTEGER) * ? AS bucket, COUNT(*) AS total
    FROM shop_restocks
    WHERE shop_type = ? AND restocked_at >= ? AND restocked_at < ?
    GROUP BY bucket
  `).all(bucketMs, bucketMs, shop, from, to);

  const totalsByBucket = new Map(totalsRows.map((r) => [r.bucket, r.total]));
  const allBuckets = buildBuckets(from, to, bucketMs);

  const placeholders = ids.map(() => "?").join(",");
  const itemRows = ids.length > 0 ? db.prepare(`
    SELECT CAST(r.restocked_at / ? AS INTEGER) * ? AS bucket,
           i.item_id,
           COUNT(*) AS appearances,
           AVG(i.stock) AS avg_stock
    FROM shop_restock_items i
    JOIN shop_restocks r ON r.id = i.restock_id
    WHERE r.shop_type = ?
      AND r.restocked_at >= ?
      AND r.restocked_at < ?
      AND i.item_id IN (${placeholders})
    GROUP BY bucket, i.item_id
  `).all(bucketMs, bucketMs, shop, from, to, ...ids) : [];

  const byItem = new Map();
  for (const id of ids) byItem.set(id, new Map());
  for (const r of itemRows) {
    byItem.get(r.item_id)?.set(r.bucket, r);
  }

  return ids.map((id) => ({
    item_id: id,
    points: allBuckets.map((t) => {
      const hit = byItem.get(id).get(t);
      const total = totalsByBucket.get(t) ?? 0;
      const app = hit?.appearances ?? 0;
      return {
        t,
        appearances: app,
        total_restocks: total,
        drop_rate: total > 0 ? app / total : 0,
        avg_stock: hit?.avg_stock ?? null,
      };
    }),
  }));
}

// =====================
// Items: aggregated stats
// =====================

const ITEM_SORT_COLS = new Set(["appearances", "drop_rate", "avg_stock", "last_seen", "item_id"]);

export function queryItemsStats({ shop, from, to, sort = "drop_rate", order = "desc" }) {
  const db = getDB();
  if (!db) return { total_restocks: 0, items: [] };

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM shop_restocks
    WHERE shop_type = ? AND restocked_at >= ? AND restocked_at < ?
  `).get(shop, from, to).n;

  const sortCol = ITEM_SORT_COLS.has(sort) ? sort : "drop_rate";
  const sortDir = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";

  if (total === 0) return { total_restocks: 0, items: [] };

  const rows = db.prepare(`
    SELECT i.item_id,
           COUNT(*) AS appearances,
           CAST(COUNT(*) AS REAL) / ? AS drop_rate,
           AVG(i.stock) AS avg_stock,
           MIN(i.stock) AS min_stock,
           MAX(i.stock) AS max_stock,
           MAX(r.restocked_at) AS last_seen
    FROM shop_restock_items i
    JOIN shop_restocks r ON r.id = i.restock_id
    WHERE r.shop_type = ?
      AND r.restocked_at >= ?
      AND r.restocked_at < ?
    GROUP BY i.item_id
    ORDER BY ${sortCol} ${sortDir}
  `).all(total, shop, from, to);

  return { total_restocks: total, items: rows };
}

// =====================
// Weather: aggregated stats
// =====================

export function queryWeatherStats({ from, to }) {
  const db = getDB();
  if (!db) return { total_duration: 0, weathers: [] };

  const now = Date.now();
  const rows = db.prepare(`
    SELECT weather, started_at, ended_at
    FROM weather_events
    WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
  `).all(to, from);

  const agg = new Map();
  let totalDur = 0;

  for (const r of rows) {
    const start = Math.max(r.started_at, from);
    const end = Math.min(r.ended_at ?? now, to);
    const dur = end - start;
    if (dur <= 0) continue;
    totalDur += dur;
    const cur = agg.get(r.weather) ?? { weather: r.weather, duration: 0, occurrences: 0 };
    cur.duration += dur;
    cur.occurrences += 1;
    agg.set(r.weather, cur);
  }

  const weathers = Array.from(agg.values()).map((w) => ({
    ...w,
    share: totalDur > 0 ? w.duration / totalDur : 0,
    avg_duration: w.occurrences > 0 ? w.duration / w.occurrences : 0,
  })).sort((a, b) => b.duration - a.duration);

  return { total_duration: totalDur, weathers };
}

// =====================
// Weather: timeseries
// =====================

export function queryWeatherTimeseries({ from, to, bucketMs }) {
  const db = getDB();
  if (!db) return [];

  const now = Date.now();
  const rows = db.prepare(`
    SELECT weather, started_at, ended_at
    FROM weather_events
    WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
  `).all(to, from);

  const bucketStartFrom = bucketStart(from, bucketMs);
  const buckets = new Map();
  for (let t = bucketStartFrom; t < to; t += bucketMs) {
    buckets.set(t, {});
  }

  for (const r of rows) {
    let evtStart = Math.max(r.started_at, from);
    const evtEnd = Math.min(r.ended_at ?? now, to);
    if (evtEnd <= evtStart) continue;

    let cursor = evtStart;
    while (cursor < evtEnd) {
      const b = bucketStart(cursor, bucketMs);
      const bEnd = b + bucketMs;
      const sliceEnd = Math.min(evtEnd, bEnd);
      const dur = sliceEnd - cursor;
      const bucketObj = buckets.get(b);
      if (bucketObj) {
        bucketObj[r.weather] = (bucketObj[r.weather] ?? 0) + dur;
      }
      cursor = sliceEnd;
    }
  }

  return Array.from(buckets.entries()).map(([t, durations]) => ({ t, durations }));
}
