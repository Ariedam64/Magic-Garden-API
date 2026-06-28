// Deterministic daily weather schedule, ported 1:1 from the game's client bundle
// (main-BOR4Xrp2.js + index-CA_QAo-_.js + BreadButton-DeBcH3F5.js).
//
// The "weather station" forecast is NOT sent over the WebSocket — it's computed
// locally from a per-UTC-day seed. The schedule is 288 five-minute slots/day.
//   - seed       = UTC date string "YYYY-MM-DD"            (so / Rb)
//   - rng        = Alea(seed)                              (dn / k, classic Alea PRNG)
//   - Hydro group: random gaps 20-35min, Rain50/Frost30/Thunderstorm20, 5min each
//   - Lunar group: fixed slots [0,48,96,144,192,240], Dawn67/AmberMoon33, 10min each
//     (Lunar is applied AFTER Hydro, so it overwrites overlapping slots)
//   - Are[date]  : hard-coded Thunderstorm overrides for specific dates (applied last)
//   - Frost is displayed to players as "Snow".

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

// Weather group config (Jg) and date overrides (Are) from the bundle.
const GROUPS = {
  Hydro: {
    durationMinutes: 5,
    randomTimeSlots: { minFrequencyMinutes: 20, maxFrequencyMinutes: 35 },
    dropTable: [
      { weatherId: 'Rain', weight: 50 },
      { weatherId: 'Frost', weight: 30 },
      { weatherId: 'Thunderstorm', weight: 20 },
    ],
  },
  Lunar: {
    durationMinutes: 10,
    fixedTimeSlots: [0, 48, 96, 144, 192, 240],
    dropTable: [
      { weatherId: 'Dawn', weight: 67 },
      { weatherId: 'AmberMoon', weight: 33 },
    ],
  },
};
const DATE_OVERRIDES = {
  '2026-06-26': [[219, 1], [231, 1]],
};

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

// Build the full slot->weatherId map for a given UTC day key (jre).
const _scheduleCache = new Map();
export function buildSchedule(dayKey) {
  if (_scheduleCache.has(dayKey)) return _scheduleCache.get(dayKey);
  const sched = {};
  const rng = alea(dayKey);
  // Hydro (randomTimeSlots) — consumes RNG first.
  for (const g of Object.values(GROUPS)) {
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
  for (const g of Object.values(GROUPS)) {
    if (!g.fixedTimeSlots) continue;
    const dur = Math.floor(g.durationMinutes / 5);
    for (const slot of g.fixedTimeSlots) {
      const w = pickWeather(g.dropTable, rng);
      for (let k = 0; k < dur; k++) sched[slot + k] = w;
    }
  }
  // Date overrides (Are) — always Thunderstorm, applied last.
  const ov = DATE_OVERRIDES[dayKey];
  if (ov) for (const [start, count] of ov) for (let k = 0; k < count; k++) sched[start + k] = 'Thunderstorm';
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

// All discrete weather events for a UTC day, consolidated as runs of identical
// weather (so a 10-min Dawn = one event, not two adjacent slots).
export function dayEvents(ms = Date.now()) {
  const dayKey = utcDayKey(ms);
  const sched = buildSchedule(dayKey);
  const base = utcMidnight(ms);
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
