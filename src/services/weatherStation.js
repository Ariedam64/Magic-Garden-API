// src/services/weatherStation.js

import {
  CLEAR_SKIES,
  DAY_MS,
  ENGINE_SIGNATURE,
  ERAS,
  MODELED_FROM,
  SLOT_MS,
  WEATHER_DISPLAY,
  canonicalWeatherKey,
  dayKeyToMs,
  eraAt,
  predictDay,
  utcDayKey,
} from "../core/weather/index.js";
import { getStoredVersionCached } from "../core/game/versionStorage.js";
import { gameDataService } from "./gameData.js";
import { liveDataService } from "./liveData.js";
import { transformWeathersWithSprites } from "./dataTransformer.js";
import { queryWeatherEvents } from "./historyQueries.js";
import { logger } from "../logger/index.js";

/**
 * Station météo : recolle le passé (historique SQLite), le présent (poller) et
 * le futur (moteur déterministe) en une seule vue.
 *
 * Le moteur est la source du futur ; l'observation live reste prioritaire sur le
 * présent, et l'écart entre les deux est exposé tel quel (`agrees_with_engine`,
 * `accuracy`) plutôt que masqué — c'est le seul signal d'alerte quand le jeu
 * change son scheduler.
 */

const CLEAR_ID = "Sunny";

// Une journée prédite est déterministe : le cache ne périme jamais, il se
// contente de rester borné (FIFO) pour les scans longue portée.
const DAY_CACHE_LIMIT = 512;
const dayCache = new Map();

// Précision sur 24h : recalculée au plus une fois par minute (SQLite est
// synchrone, et `/health` peut être sondé agressivement).
const ACCURACY_TTL_MS = 60_000;
let accuracyCache = { at: 0, value: null };

let metaCache = { spriteVersion: undefined, value: null };
let metaWarned = false;

// =====================
// Helpers
// =====================

const iso = (ms) => new Date(ms).toISOString();

function predictCached(dayKey, engineId = null) {
  const key = engineId ? `${dayKey}|${engineId}` : dayKey;

  let day = dayCache.get(key);
  if (!day) {
    day = predictDay(dayKey, engineId ? { engineId } : {});
    dayCache.set(key, day);
    if (dayCache.size > DAY_CACHE_LIMIT) dayCache.delete(dayCache.keys().next().value);
  }
  return day;
}

/**
 * Métadonnées par météo (libellé, groupe, mutation, sprite), depuis le bundle.
 *
 * L'enrichissement est un confort : si le bundle n'est pas disponible, la
 * station répond quand même, sans les champs de mutation/sprite.
 */
async function getWeatherMeta() {
  try {
    const spriteVersion = await getStoredVersionCached();
    if (metaCache.value && metaCache.spriteVersion === spriteVersion) return metaCache.value;

    const transformed = transformWeathersWithSprites(await gameDataService.getWeathers(), { spriteVersion });
    const value = {};

    for (const [id, weather] of Object.entries(transformed)) {
      value[id] = {
        name: id === CLEAR_ID ? CLEAR_SKIES : (weather?.name || WEATHER_DISPLAY[id] || id),
        group: weather?.groupId ?? null,
        mutation: weather?.mutator?.mutation ?? null,
        chance_per_minute_per_crop: weather?.mutator?.chancePerMinutePerCrop ?? null,
        sprite: weather?.sprite ?? null,
      };
    }

    metaCache = { spriteVersion, value };
    metaWarned = false;
    return value;
  } catch (error) {
    if (!metaWarned) {
      metaWarned = true;
      logger.warn({ err: error.message }, "weatherStation: weather metadata unavailable, serving unenriched events");
    }
    return metaCache.value || {};
  }
}

/** Squelette servi quand le moteur ne couvre pas l'instant demandé. */
const EMPTY_EVENT = Object.freeze({
  id: null,
  weather: null,
  group: null,
  start_slot: null,
  started_at: null,
  started_at_iso: null,
  ended_at: null,
  ended_at_iso: null,
  duration_min: null,
  clipped: false,
  status: null,
  starts_in_ms: null,
  ends_in_ms: null,
});

/** Évènement fictif couvrant un trou entre deux évènements (= beau temps). */
function clearGap(startedAt, endedAt) {
  return {
    id: CLEAR_ID,
    display: CLEAR_SKIES,
    group: null,
    startSlot: null,
    startedAt,
    endedAt,
    durationMin: Math.round((endedAt - startedAt) / 60_000),
  };
}

function serializeEvent(event, { meta = null, now = null, clipFrom = null, clipTo = null, enrich = true } = {}) {
  const startedAt = clipFrom == null ? event.startedAt : Math.max(event.startedAt, clipFrom);
  const endedAt = clipTo == null ? event.endedAt : Math.min(event.endedAt, clipTo);
  const info = meta?.[event.id] || null;

  const out = {
    id: event.id,
    weather: event.display,
    group: event.group ?? info?.group ?? null,
    start_slot: event.startSlot ?? null,
    started_at: startedAt,
    started_at_iso: iso(startedAt),
    ended_at: endedAt,
    ended_at_iso: iso(endedAt),
    duration_min: Math.round((endedAt - startedAt) / 60_000),
    clipped: startedAt !== event.startedAt || endedAt !== event.endedAt,
  };

  if (enrich && info) {
    out.mutation = info.mutation;
    out.chance_per_minute_per_crop = info.chance_per_minute_per_crop;
    out.sprite = info.sprite;
  }

  if (now != null) {
    out.status = endedAt <= now ? "past" : (startedAt <= now ? "live" : "upcoming");
    out.starts_in_ms = startedAt > now ? startedAt - now : 0;
    out.ends_in_ms = endedAt > now ? endedAt - now : 0;
  }

  return out;
}

/**
 * Évènements du moteur qui intersectent `[from, to)`, non tronqués.
 *
 * Un évènement ne franchit jamais minuit UTC (le moteur consolide par jour et
 * la collision Lunar interdit un pick Hydro qui déborderait), donc balayer les
 * jours qui recouvrent la fenêtre suffit.
 */
export function eventsBetween(from, to, { engineId = null } = {}) {
  const events = [];
  const eras = new Set();
  let modeled = false;

  for (let ms = dayKeyToMs(utcDayKey(from)); ms < to; ms += DAY_MS) {
    const day = predictCached(utcDayKey(ms), engineId);
    if (day.modeled) modeled = true;
    for (const id of day.eras) eras.add(id);
    for (const event of day.events) {
      if (event.endedAt > from && event.startedAt < to) events.push(event);
    }
  }

  events.sort((a, b) => a.startedAt - b.startedAt);
  return { from, to, modeled, eras: [...eras], events };
}

/**
 * Chronologie complète de `[from, to)` : les évènements **et** les périodes de
 * beau temps entre eux, tronqués à la fenêtre (les minutes somment donc à la
 * durée de la fenêtre).
 */
export function timelineBetween(from, to, { engineId = null } = {}) {
  const { events, modeled, eras } = eventsBetween(from, to, { engineId });

  // Hors période modélisée, l'absence d'évènement ne veut pas dire beau temps :
  // on ne sait rien, et une chronologie vide le dit mieux qu'un « Clear Skies »
  // de 24h inventé.
  if (!modeled) return { from, to, modeled, eras, timeline: [] };

  const timeline = [];
  let cursor = from;

  for (const event of events) {
    if (event.startedAt > cursor) timeline.push(clearGap(cursor, Math.min(event.startedAt, to)));
    timeline.push(event);
    cursor = Math.max(cursor, event.endedAt);
  }
  if (cursor < to) timeline.push(clearGap(cursor, to));

  return { from, to, modeled, eras, timeline };
}

/**
 * L'état à un instant donné selon le moteur : l'évènement en cours, ou la
 * période de beau temps qui l'entoure (bornée par les évènements voisins, d'où
 * la fenêtre de ±1 jour).
 */
export function stateAt(ms, { engineId = null } = {}) {
  const { events, modeled } = eventsBetween(ms - DAY_MS, ms + DAY_MS, { engineId });

  // Hors période modélisée le moteur n'a rien à dire : `null` plutôt qu'un beau
  // temps déduit d'une absence de données.
  if (!modeled) return { event: null, clear: null, modeled };

  const active = events.find((event) => event.startedAt <= ms && ms < event.endedAt);
  if (active) return { event: active, clear: false, modeled };

  let previousEnd = ms - DAY_MS;
  for (const event of events) {
    if (event.endedAt <= ms) previousEnd = Math.max(previousEnd, event.endedAt);
  }
  const next = events.find((event) => event.startedAt > ms);

  return {
    event: clearGap(previousEnd, next ? next.startedAt : ms + DAY_MS),
    clear: true,
    modeled,
  };
}

/**
 * Les `count` prochaines occurrences (celle en cours incluse), filtrables par
 * météo. Le scan s'arrête à `maxDays` : sans filtre il trouve tout de suite,
 * avec un filtre serré (Amber Moon) il peut avoir à avancer de plusieurs jours.
 */
export function nextEvents(from, { count = 5, ids = null, engineId = null, maxDays = 60 } = {}) {
  const matches = [];
  const startDay = dayKeyToMs(utcDayKey(from));
  let scannedDays = 0;

  for (let ms = startDay; scannedDays < maxDays; ms += DAY_MS, scannedDays++) {
    const day = predictCached(utcDayKey(ms), engineId);
    if (!day.modeled) continue;

    for (const event of day.events) {
      if (event.endedAt <= from) continue;
      if (ids && !ids.has(event.id)) continue;
      matches.push(event);
      if (matches.length >= count) return { events: matches, scanned_days: scannedDays + 1, complete: true };
    }
  }

  return { events: matches, scanned_days: scannedDays, complete: matches.length >= count };
}

/** Compte et minutes cumulées par météo sur une chronologie (beau temps inclus). */
export function summarize(timeline) {
  const counts = {};
  const minutes = {};

  for (const entry of timeline) {
    const label = entry.display;
    counts[label] = (counts[label] || 0) + 1;
    minutes[label] = (minutes[label] || 0) + Math.round((entry.endedAt - entry.startedAt) / 60_000);
  }

  return { counts, minutes };
}

/**
 * Résout des noms de météo fournis par un client vers des ids du moteur.
 * Accepte l'id (`AmberMoon`, `Frost`), le libellé public (`Amber Moon`, `Snow`)
 * et les variantes de casse/espaces.
 */
export function resolveWeatherIds(raw) {
  const lookup = new Map();
  const register = (key, id) => lookup.set(String(key).toLowerCase().replace(/[\s_-]+/g, ""), id);

  for (const [id, display] of Object.entries(WEATHER_DISPLAY)) {
    register(id, id);
    register(display, id);
  }
  register(CLEAR_ID, CLEAR_ID);
  register(CLEAR_SKIES, CLEAR_ID);

  const ids = new Set();
  const unknown = [];

  for (const token of String(raw).split(",").map((s) => s.trim()).filter(Boolean)) {
    const id = lookup.get(token.toLowerCase().replace(/[\s_-]+/g, ""));
    if (id) ids.add(id);
    else unknown.push(token);
  }

  return { ids, unknown };
}

// =====================
// Précision & dérive
// =====================

/**
 * Confronte le moteur à l'historique enregistré, slot de 5 min par slot de 5
 * min. Les slots sans enregistrement (API du jeu injoignable, redémarrage) sont
 * exclus du dénominateur plutôt que comptés comme des erreurs.
 */
export function accuracy({ from, to }) {
  const recorded = queryWeatherEvents({ from, to, limit: 20_000, order: "asc" });

  if (recorded.length === 0) {
    return { from, to, slot_ms: SLOT_MS, covered: 0, matched: 0, pct: null, mismatches: [] };
  }

  const recordedAt = (ms) => {
    for (const event of recorded) {
      if (event.started_at <= ms && ms < event.ended_at) return event.weather;
      if (event.started_at > ms) break;
    }
    return null;
  };

  const predictedAt = (ms) => {
    const day = predictCached(utcDayKey(ms));
    if (!day.modeled) return null;
    for (const event of day.events) {
      if (event.startedAt <= ms && ms < event.endedAt) return event.display;
    }
    return CLEAR_SKIES;
  };

  const mismatches = new Map();
  let covered = 0;
  let matched = 0;

  for (let ms = Math.ceil(from / SLOT_MS) * SLOT_MS; ms < to; ms += SLOT_MS) {
    const mid = ms + SLOT_MS / 2;
    const actual = recordedAt(mid);
    if (actual == null) continue;

    const predicted = predictedAt(mid);
    if (predicted == null) continue;

    covered++;
    if (canonicalWeatherKey(actual) === canonicalWeatherKey(predicted)) {
      matched++;
    } else {
      const key = `${actual}|${predicted}`;
      const entry = mismatches.get(key) || { recorded: actual, predicted, slots: 0, first_at: mid };
      entry.slots++;
      mismatches.set(key, entry);
    }
  }

  return {
    from,
    to,
    slot_ms: SLOT_MS,
    covered,
    matched,
    pct: covered ? Number(((100 * matched) / covered).toFixed(2)) : null,
    mismatches: [...mismatches.values()].sort((a, b) => b.slots - a.slots).slice(0, 10),
  };
}

/** Précision sur les dernières 24h, mémoïsée (sonde de santé). */
export function accuracy24h() {
  const now = Date.now();
  if (accuracyCache.value && now - accuracyCache.at < ACCURACY_TTL_MS) return accuracyCache.value;

  let value;
  try {
    const { covered, matched, pct } = accuracy({ from: now - DAY_MS, to: now });
    value = { covered, matched, pct };
  } catch (error) {
    logger.warn({ err: error.message }, "weatherStation: accuracy check failed");
    value = { covered: 0, matched: 0, pct: null };
  }

  accuracyCache = { at: now, value };
  return value;
}

/**
 * Le contrôle de dérive contre le bundle n'existe plus.
 *
 * Jusqu'à la v1141 du jeu (2026-09-11), le client embarquait le scheduler
 * complet (créneaux, drop tables) et on comparait l'ère active à
 * `weatherGroups` extrait du bundle. C'était l'**alarme précoce** : elle voyait
 * un changement de ruleset dès le déploiement du jeu, avant que la moindre
 * prédiction ne soit fausse.
 *
 * La v1141 a sorti le moteur du client — il ne reste que `durationMinutes`, et
 * ni `randomTimeSlots`, ni `fixedTimeSlots`, ni `dropTable` n'apparaissent dans
 * aucun chunk. Il n'y a donc plus rien à comparer, et `accuracy_24h` (moteur
 * contre historique réellement enregistré) devient le seul signal de dérive.
 *
 * C'est un signal **tardif** par construction : il ne bouge qu'une fois que le
 * jeu a déjà divergé, et il lui faut des évènements enregistrés pour se
 * prononcer. Une chute de `accuracy_24h.pct` est désormais le déclencheur d'une
 * revue du registre d'ères.
 */
const BUNDLE_DRIFT_REASON =
  "the game stopped shipping its weather scheduler in the client bundle (v1141, 2026-09-11); accuracy_24h is now the only drift signal";

export function checkDrift() {
  const era = eraAt(Date.now());

  return {
    checked: false,
    aligned: null,
    era: era ? era.id : null,
    reason: era ? BUNDLE_DRIFT_REASON : "no active era",
    diffs: [],
  };
}

// =====================
// Vues publiques
// =====================

/** Description du moteur : ère active, registre, borne de modélisation. */
export function getEngineInfo() {
  const era = eraAt(Date.now());

  return {
    active: era
      ? { id: era.id, label: era.label, since: era.from, until: era.to }
      : null,
    modeled_from: MODELED_FROM,
    signature: ENGINE_SIGNATURE,
    slot_ms: SLOT_MS,
    eras: ERAS.map((entry) => ({
      id: entry.id,
      label: entry.label,
      from: entry.from,
      to: entry.to,
      groups: entry.groups,
    })),
  };
}

/**
 * L'instant présent : l'observation live fait foi sur le libellé, le moteur sur
 * les bornes (l'API officielle ne renvoie ni début ni fin la plupart du temps).
 */
export async function getNow({ now = Date.now(), engineId = null, enrich = true } = {}) {
  const meta = enrich ? await getWeatherMeta() : null;
  const { event, clear, modeled } = stateAt(now, { engineId });

  const liveWeather = liveDataService.getWeather();
  const liveDetails = liveDataService.getWeatherDetails();
  const predicted = event ? event.display : null;

  const current = event ? serializeEvent(event, { meta, now, enrich }) : EMPTY_EVENT;
  const next = nextEvents(now, { count: 1, engineId }).events.filter((e) => e.startedAt > now);

  return {
    generated_at: now,
    generated_at_iso: iso(now),
    modeled,
    now: {
      ...current,
      // Le moteur décrit toujours l'intervalle ; le libellé servi privilégie ce
      // que le jeu dit réellement quand le poller a une valeur fraîche.
      weather: liveWeather || current.weather,
      predicted_weather: predicted,
      source: liveWeather ? "live" : (modeled ? "engine" : null),
      agrees_with_engine:
        liveWeather && predicted ? canonicalWeatherKey(liveWeather) === canonicalWeatherKey(predicted) : null,
      clear,
      live: liveWeather
        ? {
            weather: liveWeather,
            started_at: liveDetails?.startedAt ? Date.parse(liveDetails.startedAt) : null,
            ends_at: liveDetails?.endsAt ? Date.parse(liveDetails.endsAt) : null,
          }
        : null,
    },
    next: next.length ? serializeEvent(next[0], { meta, now, enrich }) : null,
  };
}

/**
 * Le tableau de bord : présent, prochains évènements, résumé du jour civil et
 * précision mesurée — de quoi alimenter un overlay en un seul appel.
 */
export async function getStation({ now = Date.now(), tz = "UTC", tzOffset = 0, upcoming = 5, engineId = null, enrich = true } = {}) {
  const meta = enrich ? await getWeatherMeta() : null;
  const current = await getNow({ now, engineId, enrich });

  const dayStart = Math.floor((now + tzOffset) / DAY_MS) * DAY_MS - tzOffset;
  const dayEnd = dayStart + DAY_MS;
  const day = timelineBetween(dayStart, dayEnd, { engineId });
  const { counts, minutes } = summarize(day.timeline);

  const next = nextEvents(now, { count: upcoming, engineId }).events;

  return {
    generated_at: now,
    generated_at_iso: iso(now),
    engine: {
      ...getEngineInfo().active,
      eras_today: day.eras,
      modeled_from: MODELED_FROM,
      drift: checkDrift(),
    },
    now: current.now,
    next: next.map((event) => serializeEvent(event, { meta, now, enrich })),
    today: {
      day: utcDayKey(dayStart + tzOffset),
      tz,
      tz_offset_min: Math.round(tzOffset / 60_000),
      from: dayStart,
      to: dayEnd,
      modeled: day.modeled,
      counts,
      minutes,
    },
    accuracy_24h: accuracy24h(),
  };
}

/** Instantané synchrone pour `/health` (aucune I/O, aucun await). */
export function getHealthSnapshot() {
  const era = eraAt(Date.now());

  return {
    engine: era ? era.id : null,
    modeled_from: MODELED_FROM,
    accuracy_24h: accuracy24h(),
    drift: checkDrift(),
  };
}

export const weatherStationService = {
  eventsBetween,
  timelineBetween,
  stateAt,
  nextEvents,
  summarize,
  resolveWeatherIds,
  accuracy,
  accuracy24h,
  checkDrift,
  getEngineInfo,
  getNow,
  getStation,
  getHealthSnapshot,
  getWeatherMeta,
  serializeEvent,
};
