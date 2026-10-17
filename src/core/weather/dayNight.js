// src/core/weather/dayNight.js

/**
 * Cycle jour/nuit du jeu (Haunt Event, 2026-10-16).
 *
 * Ce n'est pas une météo : `/platform/v1/weather` ne le signale jamais, et le
 * catalogue météo n'a pas bougé. Le client calcule la phase sur sa seule
 * horloge, en cycles de 600 minutes comptés depuis l'epoch Unix (chunk météo,
 * `St={day:570,sunset:10,midnight:10,sunrise:10}`) :
 *
 *   minute 0–10    sunrise
 *   minute 10–580  day
 *   minute 580–590 sunset     ← le Spooky Shop ouvre ici
 *   minute 590–600 midnight
 *
 * soit 30 minutes de nuit toutes les 10 heures. Vérifié sur l'historique : les
 * ouvertures du shop `spooky` (2026-10-16 21:40, 2026-10-17 07:40 UTC) tombent
 * toutes deux à la minute 580.
 *
 * Tout est pur : la durée des phases vient du bundle quand on sait la lire
 * (`extractStageMinutes`), sinon des valeurs ci-dessous.
 */

const MINUTE_MS = 60_000;

// Ordre des phases dans un cycle (le cycle commence au lever du soleil).
export const STAGE_ORDER = ["sunrise", "day", "sunset", "midnight"];

export const DEFAULT_STAGE_MINUTES = Object.freeze({ day: 570, sunset: 10, midnight: 10, sunrise: 10 });

// Bonus de force des pets `isNocturnal` (`yo` du chunk de données) : le jeu
// l'ajoute à la force de base avant de la diviser par 100.
export const NOCTURNAL_STRENGTH_BONUS = Object.freeze({ day: 0, sunset: 15, midnight: 20, sunrise: 10 });

// Les Haunts (fantômes à photographier) : sur chaque fenêtre de 10 minutes, ils
// sont visibles une fraction du temps qui dépend de la phase, ou 1/4 dès
// qu'une météo est active (`Oe`/`ke`, chunk `SharedRiveSprite`).
export const HAUNT_STAGE_FRACTION = Object.freeze({ day: 0, sunset: 1 / 3, midnight: 1 / 2, sunrise: 1 / 3 });
export const HAUNT_WEATHER_FRACTION = 1 / 4;
export const HAUNT_WINDOW_MS = 10 * MINUTE_MS;

// Fin de l'événement : `expiryDates-*.js`, la date d'expiration de tout le
// contenu Halloween. Le Spooky Shop et les Haunts s'arrêtent là ; le cycle
// lui-même n'a pas de date de fin dans le client.
export const HAUNT_EVENT = Object.freeze({
  id: "halloween2026",
  endsAt: Date.parse("2026-11-10T00:00:00.000Z"),
});

/**
 * Durée des phases telle que le bundle la déclare, ou null.
 *
 * La table des bonus nocturnes a exactement la même forme
 * (`{day:0,sunset:15,midnight:20,sunrise:10}`) : seule une table dont toutes
 * les phases durent est retenue.
 */
export function extractStageMinutes(source) {
  if (typeof source !== "string") return null;
  for (const m of source.matchAll(/\{day:(\d+),sunset:(\d+),midnight:(\d+),sunrise:(\d+)\}/g)) {
    const [day, sunset, midnight, sunrise] = m.slice(1).map(Number);
    if ([day, sunset, midnight, sunrise].every((n) => n > 0)) return { day, sunset, midnight, sunrise };
  }
  return null;
}

/** Bornes de chaque phase dans un cycle, en ms depuis son début. */
function stageBounds(stages) {
  const bounds = {};
  let at = 0;
  for (const stage of STAGE_ORDER) {
    const length = stages[stage] * MINUTE_MS;
    bounds[stage] = { start: at, end: at + length };
    at += length;
  }
  return { bounds, cycleMs: at };
}

/**
 * Obscurité de 0 (plein jour) à 1 (nuit noire), comme la courbe `kt` du jeu :
 * nuit noire au début du lever, jour à sa fin, puis la nuit tombe pendant le
 * coucher et reste noire jusqu'à minuit.
 */
function darknessAt(offset, bounds) {
  const points = [
    [0, 1],
    [bounds.sunrise.end, 0],
    [bounds.sunset.start, 0],
    [bounds.midnight.start, 1],
    [bounds.midnight.end, 1],
  ];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (offset >= x1) continue;
    const [x0, y0] = points[i - 1];
    return y0 + ((y1 - y0) * (offset - x0)) / (x1 - x0);
  }
  return 1;
}

/**
 * Phase à un instant donné.
 *
 * @returns {{ stage: string, phase: number, darkness: number, is_night: boolean,
 *   stage_started_at: number, stage_ends_at: number, cycle_started_at: number,
 *   cycle_ms: number, nocturnal_strength_bonus: number }}
 */
export function dayNightAt(ms, stages = DEFAULT_STAGE_MINUTES) {
  const { bounds, cycleMs } = stageBounds(stages);
  const cycleStart = Math.floor(ms / cycleMs) * cycleMs;
  const offset = ms - cycleStart;
  const stage = STAGE_ORDER.find((s) => offset < bounds[s].end) ?? "midnight";

  return {
    stage,
    phase: offset / cycleMs,
    darkness: Math.round(darknessAt(offset, bounds) * 1000) / 1000,
    is_night: stage !== "day",
    stage_started_at: cycleStart + bounds[stage].start,
    stage_ends_at: cycleStart + bounds[stage].end,
    cycle_started_at: cycleStart,
    cycle_ms: cycleMs,
    nocturnal_strength_bonus: NOCTURNAL_STRENGTH_BONUS[stage] ?? 0,
  };
}

/**
 * Les `count` prochaines nuits, celle en cours incluse. Une nuit va du début du
 * coucher à la fin du lever, qui appartient au cycle suivant.
 *
 * @returns {Array<{ sunset_at: number, midnight_at: number, sunrise_at: number, ends_at: number }>}
 */
export function nightsFrom(ms, count = 5, stages = DEFAULT_STAGE_MINUTES) {
  const { bounds, cycleMs } = stageBounds(stages);
  const nights = [];
  let cycleStart = Math.floor(ms / cycleMs) * cycleMs;

  // Le lever en cours appartient à la nuit commencée au cycle précédent.
  if (ms - cycleStart < bounds.sunrise.end) cycleStart -= cycleMs;

  while (nights.length < count) {
    const night = {
      sunset_at: cycleStart + bounds.sunset.start,
      midnight_at: cycleStart + bounds.midnight.start,
      sunrise_at: cycleStart + cycleMs + bounds.sunrise.start,
      ends_at: cycleStart + cycleMs + bounds.sunrise.end,
    };
    if (night.ends_at > ms) nights.push(night);
    cycleStart += cycleMs;
  }

  return nights;
}

/**
 * Les Haunts à un instant donné.
 *
 * `visible_fraction` est la part de chaque fenêtre de 10 minutes pendant
 * laquelle un Haunt se montre ; 0 en plein jour sans météo, et toujours 0
 * après la fin de l'événement.
 */
export function hauntsAt(ms, { stage, weatherActive = false }) {
  const live = ms < HAUNT_EVENT.endsAt;
  const fraction = live
    ? Math.max(HAUNT_STAGE_FRACTION[stage] ?? 0, weatherActive ? HAUNT_WEATHER_FRACTION : 0)
    : 0;

  return {
    active: fraction > 0,
    visible_fraction: Math.round(fraction * 1000) / 1000,
    visible_minutes_per_window: Math.round(fraction * (HAUNT_WINDOW_MS / MINUTE_MS) * 100) / 100,
    event: HAUNT_EVENT.id,
    event_ends_at: HAUNT_EVENT.endsAt,
  };
}

/**
 * Prochaine ouverture du Spooky Shop : il ouvre à chaque coucher de soleil
 * tant que l'événement dure. null une fois l'événement terminé.
 */
export function nextSpookyShopOpening(ms, stages = DEFAULT_STAGE_MINUTES) {
  const [next] = nightsFrom(ms, 2, stages).filter((night) => night.sunset_at > ms);
  if (!next || next.sunset_at >= HAUNT_EVENT.endsAt) return null;
  return next.sunset_at;
}
