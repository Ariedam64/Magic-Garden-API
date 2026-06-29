// Deterministic daily weather schedule, ported 1:1 from the game's client bundle
// (main-BOR4Xrp2.js + index-CA_QAo-_.js + BreadButton-DeBcH3F5.js).
//
// The "weather station" forecast is NOT sent over the WebSocket — it's computed
// locally from a per-UTC-day seed. The schedule is 288 five-minute slots/day.
//   - seed       = UTC date string "YYYY-MM-DD"            (so / Rb)
//   - rng        = Alea(seed)                              (dn / k, classic Alea PRNG)
//   - Hydro group: random gaps 20-35min, weighted Rain/Frost/Thunderstorm, 5min each
//   - Lunar group: fixed slots [0,48,96,144,192,240], Dawn67/AmberMoon33, 10min each
//     (Lunar is applied AFTER Hydro, so it overwrites overlapping slots)
//   - Are[date]  : hard-coded Thunderstorm overrides for specific dates (applied last)
//   - Frost is displayed to players as "Snow".
//
// ERAS: the game has changed its weather config over time. Each era is a
// self-contained "engine" valid over a UTC-date range, with its own scheduling
// + drop-table weights + date overrides. `buildSchedule` picks the era matching
// the day. Verified against recorded history (data/history.sqlite):
//   - v2 (>= 2026-03-06): Rain50/Frost30/Thunderstorm20 — 100% match.
//   - v1 (2026-02-20..2026-03-05): SAME scheduling, Rain/Frost SWAPPED
//     (Rain30/Frost50/Thunderstorm20). Recovered by RNG-replay (fit 0.14%).
//   - before 2026-02-20: a different, not-yet-reverse-engineered system
//     (positions decorrelated from this PRNG) — intentionally UNMODELED.

export const SLOT_MS = 300000; // 5 minutes
export const SLOTS_PER_DAY = 288;

// Alea PRNG (David Bau's seedrandom) — exact port of the bundle's mash (A) + alea (k).
function mkMash() {
  let e = 4022871197;
  return t => {
    const n = String(t);
    for (let i = 0; i < n.length; i++) {
      e += n.charCodeAt(i);
      let r = 0.02519603282416938 * e;
      e = r >>> 0; r -= e; r *= e; e = r >>> 0; r -= e; e += r * 4294967296;
    }
    return (e >>> 0) * 2.3283064365386963e-10;
  };
}
function alea(...seeds) {
  let t = 0, n = 0, r = 0, i = 1, a = mkMash();
  t = a(' '); n = a(' '); r = a(' ');
  for (const s of seeds) {
    t -= a(s); if (t < 0) t += 1;
    n -= a(s); if (n < 0) n += 1;
    r -= a(s); if (r < 0) r += 1;
  }
  a = null;
  return () => {
    const e = 2091639 * t + i * 2.3283064365386963e-10;
    t = n; n = r; i = e | 0; r = e - i; return r;
  };
}

// The Lunar group has never changed across observed eras.
const LUNAR_GROUP = {
  durationMinutes: 10,
  fixedTimeSlots: [0, 48, 96, 144, 192, 240],
  dropTable: [
    { weatherId: 'Dawn', weight: 67 },
    { weatherId: 'AmberMoon', weight: 33 },
  ],
};
// Hydro scheduling (gaps / duration) is shared; only the drop-table weights vary.
function hydroGroup(dropTable) {
  return {
    durationMinutes: 5,
    randomTimeSlots: { minFrequencyMinutes: 20, maxFrequencyMinutes: 35 },
    dropTable,
  };
}

// Weather eras, newest first. `from`/`to` are inclusive UTC day keys ("YYYY-MM-DD");
// `to: null` means open-ended (up to today). Days matching no era are unmodeled.
export const ERAS = [
  {
    id: 'v2',
    label: 'Rain-heavy (current)',
    bundle: 'main-BOR4Xrp2.js',
    from: '2026-03-06',
    to: null,
    groups: {
      Hydro: hydroGroup([
        { weatherId: 'Rain', weight: 50 },
        { weatherId: 'Frost', weight: 30 },
        { weatherId: 'Thunderstorm', weight: 20 },
      ]),
      Lunar: LUNAR_GROUP,
    },
    dateOverrides: {
      '2026-06-26': [[219, 1], [231, 1]],
    },
  },
  {
    id: 'v1',
    label: 'Frost-heavy (Rain/Frost swapped)',
    from: '2026-02-20',
    to: '2026-03-05',
    groups: {
      Hydro: hydroGroup([
        { weatherId: 'Rain', weight: 30 },
        { weatherId: 'Frost', weight: 50 },
        { weatherId: 'Thunderstorm', weight: 20 },
      ]),
      Lunar: LUNAR_GROUP,
    },
    dateOverrides: {},
  },
];

// First modeled day (anything strictly before this uses an unknown system).
export const MODELED_FROM = ERAS[ERAS.length - 1].from;

// Pick the era covering a UTC day key, or null if the day is unmodeled.
export function eraFor(dayKey) {
  for (const era of ERAS) {
    if (dayKey >= era.from && (era.to === null || dayKey <= era.to)) return era;
  }
  return null;
}

// Whether the deterministic engine can model a given day (ms or day key).
export function isModeled(dayOrMs) {
  const key = typeof dayOrMs === 'string' ? dayOrMs : utcDayKey(dayOrMs);
  return eraFor(key) !== null;
}

// Player-facing display names (Frost -> "Snow").
export const DISPLAY = {
  Rain: 'Rain',
  Frost: 'Snow',
  Thunderstorm: 'Thunderstorm',
  Dawn: 'Dawn',
  AmberMoon: 'Amber Moon',
};

// Weighted pick (Dre/Ore/n_).
function pickWeather(dropTable, rng) {
  const weights = dropTable.map(d => d.weight);
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (total <= 0) return undefined;
  const r = rng() * total;
  let acc = 0;
  for (let k = 0; k < weights.length; k++) {
    if (!(weights[k] <= 0)) {
      acc += weights[k];
      if (r <= acc) return dropTable[k].weatherId;
    }
  }
  return undefined;
}

export function utcDayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }
export function utcMidnight(ms) { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }
export function slotOf(ms) { return Math.floor((ms - utcMidnight(ms)) / SLOT_MS); }

// Core builder: slot->weatherId map from an explicit seed + groups + overrides.
// RNG consumption order (Hydro randomTimeSlots first, then Lunar fixedTimeSlots,
// then date overrides) is significant and must not change.
function assembleSchedule({ seed, groups, dateOverrides, dayKey }) {
  const sched = {};
  if (!groups) return sched;
  const rng = alea(seed);
  // Hydro (randomTimeSlots) — consumes RNG first.
  for (const g of Object.values(groups)) {
    if (!g.randomTimeSlots) continue;
    const lo = Math.floor(g.randomTimeSlots.minFrequencyMinutes / 5);
    const hi = Math.floor(g.randomTimeSlots.maxFrequencyMinutes / 5);
    const dur = Math.floor(g.durationMinutes / 5);
    let slot = Math.floor(rng() * lo);
    while (slot < SLOTS_PER_DAY) {
      const w = pickWeather(g.dropTable, rng);
      for (let k = 0; k < dur; k++) sched[slot + k] = w;
      slot += Math.max(1, lo + Math.floor((hi - lo) * rng()));
    }
  }
  // Lunar (fixedTimeSlots) — overwrites overlapping Hydro slots.
  for (const g of Object.values(groups)) {
    if (!g.fixedTimeSlots) continue;
    const dur = Math.floor(g.durationMinutes / 5);
    for (const slot of g.fixedTimeSlots) {
      const w = pickWeather(g.dropTable, rng);
      for (let k = 0; k < dur; k++) sched[slot + k] = w;
    }
  }
  // Date overrides (Are) — always Thunderstorm, applied last.
  const ov = dateOverrides && dateOverrides[dayKey];
  if (ov) for (const [start, count] of ov) for (let k = 0; k < count; k++) sched[start + k] = 'Thunderstorm';
  return sched;
}

// Build the full slot->weatherId map for a given UTC day key (jre), using the
// era that covers the day. Unmodeled days return an empty (all-clear) schedule.
const _scheduleCache = new Map();
export function buildSchedule(dayKey) {
  if (_scheduleCache.has(dayKey)) return _scheduleCache.get(dayKey);
  const era = eraFor(dayKey);
  const sched = era
    ? assembleSchedule({ seed: dayKey, groups: era.groups, dateOverrides: era.dateOverrides, dayKey })
    : {};
  _scheduleCache.set(dayKey, sched);
  return sched;
}

// Current weather at `now` (ms), or null if clear.
export function currentWeather(now = Date.now()) {
  const sched = buildSchedule(utcDayKey(now));
  const id = sched[slotOf(now)];
  return id ? { id, display: DISPLAY[id] || id } : null;
}

// Upcoming weather events from `now`, scanning forward up to `days` UTC days.
export function upcoming(now = Date.now(), { days = 2, limit = 12 } = {}) {
  const out = [];
  const startSlot = slotOf(now);
  let prev = buildSchedule(utcDayKey(now))[startSlot] || null;
  for (let d = 0; d < days && out.length < limit; d++) {
    const dayMs = utcMidnight(now) + d * SLOTS_PER_DAY * SLOT_MS;
    const sched = buildSchedule(utcDayKey(dayMs));
    const from = d === 0 ? startSlot + 1 : 0;
    for (let sl = from; sl < SLOTS_PER_DAY && out.length < limit; sl++) {
      const id = sched[sl] || null;
      if (id !== prev) {
        if (id) {
          const at = dayMs + sl * SLOT_MS;
          out.push({ id, display: DISPLAY[id] || id, at, inMs: at - now, inMinutes: Math.round((at - now) / 60000) });
        }
        prev = id;
      }
    }
  }
  return out;
}

// Consolidate a slot->weatherId map into discrete runs of identical weather
// (so a 10-min Dawn = one event, not two adjacent slots). `base` = UTC midnight.
function consolidate(sched, base) {
  const out = [];
  let cur = null;
  for (let sl = 0; sl < SLOTS_PER_DAY; sl++) {
    const id = sched[sl] || null;
    if (cur && cur.id === id) { cur.endSlot = sl; continue; }
    if (cur) out.push(cur);
    cur = id ? { id, display: DISPLAY[id] || id, startSlot: sl, endSlot: sl } : null;
  }
  if (cur) out.push(cur);
  return out.map(e => ({
    id: e.id,
    display: e.display,
    startSlot: e.startSlot,
    endSlot: e.endSlot,
    startedAt: base + e.startSlot * SLOT_MS,
    endedAt: base + (e.endSlot + 1) * SLOT_MS,
    durationMin: (e.endSlot - e.startSlot + 1) * 5,
  }));
}

// All discrete weather events for a UTC day, consolidated as runs of identical
// weather (so a 10-min Dawn = one event, not two adjacent slots).
export function dayEvents(ms = Date.now()) {
  return consolidate(buildSchedule(utcDayKey(ms)), utcMidnight(ms));
}

// ---------------------------------------------------------------------------
// Parametric prediction (powers the /weather-prediction explorer + export).
// Lets callers override the seed and the drop-table weights, and falls back to
// the current (v2) scheduling shape when a date predates any modeled era.
// ---------------------------------------------------------------------------

const SANDBOX_GROUPS = ERAS[0].groups; // current scheduling shape for unmodeled dates

function dayKeyToMs(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
// Clone groups, replacing Hydro and/or Lunar drop-table weights.
function withWeights(groups, hydro, lunar) {
  const out = {};
  for (const [name, g] of Object.entries(groups)) {
    let dropTable = g.dropTable;
    if (name === 'Hydro' && hydro) {
      dropTable = [
        { weatherId: 'Rain', weight: num(hydro.Rain, 50) },
        { weatherId: 'Frost', weight: num(hydro.Frost, 30) },
        { weatherId: 'Thunderstorm', weight: num(hydro.Thunderstorm, 20) },
      ];
    } else if (name === 'Lunar' && lunar) {
      dropTable = [
        { weatherId: 'Dawn', weight: num(lunar.Dawn, 67) },
        { weatherId: 'AmberMoon', weight: num(lunar.AmberMoon, 33) },
      ];
    }
    out[name] = { ...g, dropTable };
  }
  return out;
}
function describeWeights(groups) {
  const w = {};
  for (const [name, g] of Object.entries(groups)) {
    w[name] = Object.fromEntries(g.dropTable.map(d => [DISPLAY[d.weatherId] || d.weatherId, d.weight]));
  }
  return w;
}

// Predict one UTC day, honoring optional { seed, hydroWeights, lunarWeights }.
// Returns era/source/seed/weights metadata plus consolidated events.
export function predictDay(dayKey, opts = {}) {
  const era = eraFor(dayKey);
  const hasWeightOverride = !!(opts.hydroWeights || opts.lunarWeights);
  const hasSeedOverride = typeof opts.seed === 'string' && opts.seed.length > 0;

  let groups, source;
  if (era && !hasWeightOverride) {
    groups = era.groups;
    source = hasSeedOverride ? `${era.id}+seed` : era.id;
  } else if (era && hasWeightOverride) {
    groups = withWeights(era.groups, opts.hydroWeights, opts.lunarWeights);
    source = `${era.id}+custom`;
  } else if (!era && (hasWeightOverride || hasSeedOverride)) {
    groups = withWeights(SANDBOX_GROUPS, opts.hydroWeights, opts.lunarWeights);
    source = 'sandbox';
  } else {
    // Unmodeled date, no overrides -> nothing to predict.
    return { dayKey, era: null, source: null, modeled: false, seed: null, weights: null, events: [] };
  }

  const seed = hasSeedOverride ? opts.seed : dayKey;
  // Date overrides only make sense for the canonical era seed of that day.
  const dateOverrides = era && !hasSeedOverride ? era.dateOverrides : {};
  const sched = assembleSchedule({ seed, groups, dateOverrides, dayKey });
  return {
    dayKey,
    era: era ? era.id : null,
    source,
    modeled: true,
    seed,
    weights: describeWeights(groups),
    events: consolidate(sched, dayKeyToMs(dayKey)),
  };
}

// Predict every UTC day in [fromKey, toKey] inclusive. Returns { days, events }
// where events carry absolute UTC timestamps. Capped to MAX_RANGE_DAYS days.
export const MAX_RANGE_DAYS = 400;
export function predictRange(fromKey, toKey, opts = {}) {
  const from = dayKeyToMs(fromKey), to = dayKeyToMs(toKey);
  if (!(from <= to)) throw new Error('from must be <= to');
  if ((to - from) / (SLOTS_PER_DAY * SLOT_MS) + 1 > MAX_RANGE_DAYS) {
    throw new Error(`range too large (max ${MAX_RANGE_DAYS} days)`);
  }
  const days = [], events = [];
  for (let d = from; d <= to; d += SLOTS_PER_DAY * SLOT_MS) {
    const r = predictDay(utcDayKey(d), opts);
    days.push({ dayKey: r.dayKey, era: r.era, source: r.source, modeled: r.modeled, seed: r.seed, weights: r.weights });
    for (const e of r.events) events.push(e);
  }
  return { days, events };
}

// All weather events whose start falls within [startMs, endMs), in order.
// A local calendar day can straddle two UTC schedule days, so we scan every
// UTC day the range touches and filter by absolute timestamp.
export function eventsInRange(startMs, endMs) {
  const out = [];
  for (let d = utcMidnight(startMs); d <= utcMidnight(endMs - 1); d += SLOTS_PER_DAY * SLOT_MS) {
    for (const e of dayEvents(d)) if (e.startedAt >= startMs && e.startedAt < endMs) out.push(e);
  }
  return out;
}

export function nextWeather(now = Date.now()) {
  const up = upcoming(now, { limit: 1 });
  return up.length ? up[0] : null;
}
