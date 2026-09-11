// src/core/weather/days.js

/**
 * Unités de temps du planning météo.
 *
 * Le jeu découpe la journée UTC en slots de 5 minutes : tout le moteur
 * (durées, fréquences, slots fixes) raisonne en slots, jamais en millisecondes.
 */
export const SLOT_MS = 300_000;
export const SLOTS_PER_DAY = 288;
export const DAY_MS = SLOT_MS * SLOTS_PER_DAY;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `"2026-09-08"` -> ms epoch du 00:00 UTC de ce jour.
 */
export function dayKeyToMs(key) {
  const [y, m, d] = String(key).split("-");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/**
 * ms epoch -> clé du jour UTC qui le contient (`"2026-09-08"`).
 */
export function utcDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Valide une clé de jour : format `YYYY-MM-DD` **et** date réelle (le
 * 2026-02-31 est rejeté, `Date.UTC` le décalerait silencieusement).
 */
export function isValidDayKey(key) {
  if (!DAY_KEY_RE.test(String(key))) return false;
  const ms = dayKeyToMs(key);
  return Number.isFinite(ms) && utcDayKey(ms) === key;
}

/**
 * Slot -> heure murale UTC (`48` -> `"04:00"`).
 */
export function slotToUtcTime(slot) {
  const mins = slot * 5;
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Décalage UTC (ms) d'une zone IANA à un instant donné : on formate l'instant
 * en heure murale dans la zone, on le relit comme de l'UTC, et on prend la
 * différence. Passer par `Intl` plutôt que par une table d'offsets fait suivre
 * l'heure d'été (Europe/Paris = UTC+2 en juillet, UTC+1 en janvier).
 *
 * @throws {RangeError} si `tzId` n'est pas une zone IANA connue.
 */
export function tzOffsetMs(tzId, atMs) {
  const aligned = Math.floor(atMs / 60_000) * 60_000;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tzId,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const p = {};
  for (const part of dtf.formatToParts(new Date(aligned))) p[part.type] = part.value;

  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - aligned;
}
