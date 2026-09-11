// src/core/weather/schedule.js

import { SLOT_MS, SLOTS_PER_DAY, DAY_MS, dayKeyToMs, utcDayKey } from "./days.js";
import {
  ERAS,
  WEATHER_DISPLAY,
  DECK_SEED_NS,
  REALITY_PATCHES,
  eraById,
  eraFor,
  erasForDay,
  groupIndex,
} from "./eras.js";

/**
 * Moteur météo déterministe.
 *
 * Le jeu ne diffuse pas son planning : il le **recalcule** chez chaque joueur à
 * partir d'un PRNG Alea seedé par le jour UTC (`"2026-09-08"`). Rejouer le même
 * algorithme avec le même seed donne donc la journée entière à l'avance, sans
 * rien demander à personne — d'où la prédiction plutôt que l'observation.
 *
 * Ce fichier est un portage à l'identique de l'implémentation du bundle : les
 * fonctions gardent l'ordre exact des tirages, parce que le moindre appel de rng
 * en trop décale tout le reste de la journée.
 */

// =====================
// PRNG (Alea, tel qu'embarqué par le jeu)
// =====================

function makeMash() {
  let e = 4022871197;
  return (t) => {
    const n = String(t);
    for (let i = 0; i < n.length; i++) {
      e += n.charCodeAt(i);
      let r = 0.02519603282416938 * e;
      e = r >>> 0;
      r -= e;
      r *= e;
      e = r >>> 0;
      r -= e;
      e += r * 4294967296;
    }
    return (e >>> 0) * 2.3283064365386963e-10;
  };
}

export function alea(seed) {
  let t = 0, n = 0, r = 0, i = 1;
  let mash = makeMash();

  t = mash(" ");
  n = mash(" ");
  r = mash(" ");
  t -= mash(seed); if (t < 0) t += 1;
  n -= mash(seed); if (n < 0) n += 1;
  r -= mash(seed); if (r < 0) r += 1;
  mash = null;

  return () => {
    const e = 2091639 * t + i * 2.3283064365386963e-10;
    t = n;
    n = r;
    i = e | 0;
    r = e - i;
    return r;
  };
}

// =====================
// Tirages
// =====================

/** Tirage pondéré dans une drop table. */
function pick(dropTable, rng) {
  let total = 0;
  for (const drop of dropTable) if (drop.weight > 0) total += drop.weight;
  if (total <= 0) return undefined;

  const r = rng() * total;
  let acc = 0;
  for (const drop of dropTable) {
    if (drop.weight > 0) {
      acc += drop.weight;
      if (r <= acc) return drop.weatherId;
    }
  }
  return undefined;
}

/** Fisher-Yates piloté par le rng du deck (miroir du helper du bundle). */
function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Quels slots fixes reçoivent la météo distribuée (Amber Moon) ce jour-là.
 *
 * Le deck est seedé **par cycle**, pas par jour : un rng choisit la répartition
 * et mélange les 6 slots, puis chaque jour du cycle prend sa tranche consécutive
 * du deck mélangé. `dayIndex` = nombre de jours depuis l'epoch, ce qui rend le
 * deck indépendant du seed météo quotidien.
 */
function deckDeal(group, dayIndex) {
  const { cycleDays, splits } = group.deck;
  const cycle = Math.floor(dayIndex / cycleDays);
  const dayInCycle = dayIndex - cycle * cycleDays;

  const rng = alea(`${DECK_SEED_NS}:${cycle}`);
  const split = splits[Math.floor(rng() * splits.length)] || splits[0];
  const deck = shuffle(group.fixedTimeSlots, rng);

  let offset = 0;
  for (let i = 0; i < dayInCycle; i++) offset += split[i] || 0;

  return new Set(deck.slice(offset, offset + (split[dayInCycle] || 0)));
}

/**
 * Un pick Hydro chevauche-t-il un slot fixe (Lunar) ?
 *
 * Lunar l'emporte toujours. Avant la bascule c'était invisible (les 5 min
 * d'Hydro tombaient entièrement dans la fenêtre Lunar de 10 min et étaient
 * simplement écrasées — vérifié sur 44 jours d'historique réel, 0 écart).
 * Depuis, Hydro dure aussi 10 min et la collision peut être partielle : comme un
 * évènement ne peut plus être plus court que sa durée configurée, un pick Hydro
 * en collision est abandonné plutôt que tronqué. Les slots fixes se répètent à
 * l'identique chaque jour, donc un pick de 10 min au slot 287 (23:55) qui déborde
 * sur le Lunar de 00:00 est aussi une collision — d'où la passe `+SLOTS_PER_DAY`
 * (sans effet pour un Hydro de 5 min, qui ne peut pas franchir minuit).
 */
function overlapsFixed(slot, duration, groups) {
  for (const group of Object.values(groups)) {
    if (!group.fixedTimeSlots) continue;
    const fixedDuration = Math.floor(group.durationMinutes / 5);

    for (const fixedSlot of group.fixedTimeSlots) {
      if (slot < fixedSlot + fixedDuration && slot + duration > fixedSlot) return true;
      if (slot < fixedSlot + SLOTS_PER_DAY + fixedDuration && slot + duration > fixedSlot + SLOTS_PER_DAY) return true;
    }
  }
  return false;
}

/**
 * Construit le planning brut d'une journée : `{ slotIndex: weatherId }`.
 *
 * Les groupes aléatoires consomment le rng du jour en premier, puis les groupes
 * à slots fixes — cet ordre fait partie de l'algorithme, pas du style.
 */
function assemble(seed, groups, dateOverrides, dayKey) {
  const schedule = {};
  if (!groups) return schedule;

  const rng = alea(seed);

  for (const group of Object.values(groups)) {
    if (!group.randomTimeSlots) continue;

    const lo = Math.floor(group.randomTimeSlots.minFrequencyMinutes / 5);
    const hi = Math.floor(group.randomTimeSlots.maxFrequencyMinutes / 5);
    const duration = Math.floor(group.durationMinutes / 5);

    let slot = Math.floor(rng() * lo);
    while (slot < SLOTS_PER_DAY) {
      const weatherId = pick(group.dropTable, rng);
      if (!overlapsFixed(slot, duration, groups)) {
        for (let k = 0; k < duration; k++) schedule[slot + k] = weatherId;
      }
      slot += Math.max(1, lo + Math.floor((hi - lo) * rng()));
    }
  }

  const dayIndex = Math.round(dayKeyToMs(dayKey) / DAY_MS);

  for (const group of Object.values(groups)) {
    if (!group.fixedTimeSlots) continue;

    const duration = Math.floor(group.durationMinutes / 5);
    // Un groupe à deck tire sur son rng de cycle et ne touche jamais au rng du
    // jour ; un groupe à slots fixes classique consomme un pick par slot,
    // comme il l'a toujours fait.
    const dealt = group.deck ? deckDeal(group, dayIndex) : null;

    for (const slot of group.fixedTimeSlots) {
      const weatherId = dealt
        ? (dealt.has(slot) ? group.deck.dealtWeatherId : group.deck.baseWeatherId)
        : pick(group.dropTable, rng);
      for (let k = 0; k < duration; k++) schedule[slot + k] = weatherId;
    }
  }

  applyOverrides(schedule, dateOverrides && dateOverrides[dayKey]);
  return schedule;
}

function applyOverrides(schedule, overrides) {
  if (!overrides) return;
  for (const [start, count, weatherId] of overrides) {
    for (let k = 0; k < count; k++) {
      schedule[start + k] = weatherId === undefined ? "Thunderstorm" : weatherId;
    }
  }
}

/**
 * Mode auto pour un jour à cheval sur une transition d'ère : on simule la
 * journée **entière** indépendamment sous chaque ère qui la recouvre (même seed
 * quotidien, donc chaque simulation reste cohérente avec son propre couple
 * Hydro/Lunar), puis on ne garde de chacune que la tranche correspondant à sa
 * plage réelle. Ça évite le problème du flux de rng partagé : changer les
 * paramètres en cours de boucle désynchroniserait Lunar.
 */
function assembleAutoDay(dayKey, segments) {
  if (segments.length === 1) {
    return assemble(dayKey, segments[0].era.groups, REALITY_PATCHES, dayKey);
  }

  const dayStart = dayKeyToMs(dayKey);
  const schedule = {};

  for (const segment of segments) {
    const full = assemble(dayKey, segment.era.groups, {}, dayKey);
    const from = Math.max(0, Math.round((segment.fromMs - dayStart) / SLOT_MS));
    const to = Math.min(SLOTS_PER_DAY, Math.round((segment.toMs - dayStart) / SLOT_MS));
    for (let slot = from; slot < to; slot++) schedule[slot] = full[slot];
  }

  applyOverrides(schedule, REALITY_PATCHES[dayKey]);
  return schedule;
}

/**
 * Slots contigus de même météo -> évènements datés.
 */
function consolidate(schedule, base, groups) {
  const index = groupIndex(groups);
  const runs = [];
  let current = null;

  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    const id = schedule[slot] || null;
    if (current && current.id === id) {
      current.endSlot = slot;
      continue;
    }
    if (current) runs.push(current);
    current = id ? { id, startSlot: slot, endSlot: slot } : null;
  }
  if (current) runs.push(current);

  return runs.map((run) => ({
    id: run.id,
    display: WEATHER_DISPLAY[run.id] || run.id,
    group: index[run.id] || null,
    startSlot: run.startSlot,
    startedAt: base + run.startSlot * SLOT_MS,
    endedAt: base + (run.endSlot + 1) * SLOT_MS,
    durationMin: (run.endSlot - run.startSlot + 1) * 5,
  }));
}

/**
 * Prédit une journée UTC complète.
 *
 * Mode auto (défaut) : l'ère est choisie par date, et les patches "reality"
 * s'appliquent. Avec `engineId`, on simule ce ruleset seul sur toute la journée,
 * sans patch — c'est le mode "et si le jeu tournait encore en v2 ?".
 *
 * @param {string} dayKey - `"YYYY-MM-DD"` (jour UTC)
 * @param {{ engineId?: string }} [opts]
 * @returns {{ dayKey: string, era: string|null, eras: string[], source: string|null,
 *             modeled: boolean, events: Array }}
 */
export function predictDay(dayKey, opts = {}) {
  const forcedId = opts.engineId || null;

  if (!forcedId) {
    const segments = erasForDay(dayKey);
    if (!segments.length) {
      return { dayKey, era: null, eras: [], source: null, modeled: false, events: [] };
    }

    const ids = segments.map((segment) => segment.era.id);
    const groups = segments[segments.length - 1].era.groups;
    const schedule = assembleAutoDay(dayKey, segments);

    return {
      dayKey,
      era: ids.join("→"),
      eras: ids,
      source: ids.join("→"),
      modeled: true,
      events: consolidate(schedule, dayKeyToMs(dayKey), groups),
    };
  }

  const era = eraById(forcedId);
  if (!era) {
    return { dayKey, era: null, eras: [], source: null, modeled: false, events: [] };
  }

  const schedule = assemble(dayKey, era.groups, {}, dayKey);
  return {
    dayKey,
    era: era.id,
    eras: [era.id],
    source: era.id,
    modeled: true,
    events: consolidate(schedule, dayKeyToMs(dayKey), era.groups),
  };
}

/**
 * Prédit une plage de jours UTC inclusive.
 *
 * @param {string} fromKey - `"YYYY-MM-DD"`
 * @param {string} toKey - `"YYYY-MM-DD"`
 * @param {{ engineId?: string }} [opts]
 */
export function predictRange(fromKey, toKey, opts = {}) {
  const from = dayKeyToMs(fromKey);
  const to = dayKeyToMs(toKey);
  const days = [];
  const events = [];

  for (let ms = from; ms <= to; ms += DAY_MS) {
    const day = predictDay(utcDayKey(ms), opts);
    days.push({ dayKey: day.dayKey, era: day.era, eras: day.eras, source: day.source, modeled: day.modeled });
    for (const event of day.events) events.push(event);
  }

  return { days, events };
}

export { ERAS, WEATHER_DISPLAY, eraById, eraFor, erasForDay };
