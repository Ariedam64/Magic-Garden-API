// src/core/platform/weather.js

import { logger } from "../../logger/index.js";

/**
 * Normalisation de la météo renvoyée par `/platform/v1/weather`.
 *
 * L'endpoint répond `null` hors évènement météo : c'est la réponse normale, pas
 * une erreur — le jeu ne considère « beau temps » comme un évènement, alors que
 * notre API l'expose depuis toujours comme `Clear Skies` (et l'historique
 * SQLite en a ~18 600 lignes). On garde donc cette convention.
 */

const CLEAR_SKIES = "Clear Skies";

/**
 * Libellés publics par id interne du jeu (cf. `/data/weathers`).
 *
 * Ces libellés sont ceux servis depuis l'époque WebSocket et stockés dans
 * `weather_events` : les changer casserait la continuité de l'historique.
 * `Sunny` reste mappé sur `Clear Skies`, et `Frost` sur `Snow` (le jeu affiche
 * lui aussi « Snow » pour l'id `Frost`).
 */
const WEATHER_LABELS = {
  sunny: CLEAR_SKIES,
  clear: CLEAR_SKIES,
  clearskies: CLEAR_SKIES,
  none: CLEAR_SKIES,
  rain: "Rain",
  frost: "Snow",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
  thunder: "Thunderstorm",
  dawn: "Dawn",
  ambermoon: "Amber Moon",
};

// Clés candidates pour l'identifiant météo dans un payload objet. L'endpoint ne
// renvoie qu'un `null` tant qu'aucun évènement n'est actif, donc la forme active
// n'est pas connue avec certitude : on cherche l'id là où il peut
// raisonnablement se trouver plutôt que de casser au premier orage.
const ID_KEYS = ["weatherId", "weather", "type", "id", "name", "state", "kind", "event"];
const START_KEYS = ["startedAt", "startsAt", "startAt", "beganAt", "beginsAt", "activeSince", "start"];
const END_KEYS = ["endsAt", "endAt", "endedAt", "expiresAt", "until", "end"];

let warnedUnknownShape = false;

/**
 * "AmberMoon" -> "Amber Moon". Filet de sécurité pour une météo que le jeu
 * ajouterait sans qu'on ait mis `WEATHER_LABELS` à jour.
 */
function humanizeId(raw) {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convertit un id/label météo en libellé public.
 */
export function formatWeather(value) {
  if (value == null) return CLEAR_SKIES;

  const raw = String(value).trim();
  if (!raw) return CLEAR_SKIES;

  return WEATHER_LABELS[raw.toLowerCase().replace(/[\s_-]+/g, "")] ?? humanizeId(raw);
}

/**
 * Première valeur chaîne non vide trouvée parmi `keys`.
 */
function pickString(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Premier timestamp ISO valide trouvé parmi `keys`.
 */
function pickTimestamp(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      // Tolère secondes comme millisecondes.
      const ms = value > 1e12 ? value : value * 1000;
      return new Date(ms).toISOString();
    }
  }
  return null;
}

/**
 * Normalise la réponse de `/platform/v1/weather`.
 *
 * @returns {{ weather: string, startedAt: string|null, endsAt: string|null, active: boolean }}
 */
export function normalizeWeather(payload) {
  // Hors évènement : `null`.
  if (payload == null) {
    return { weather: CLEAR_SKIES, startedAt: null, endsAt: null, active: false };
  }

  if (typeof payload === "string") {
    const weather = formatWeather(payload);
    return { weather, startedAt: null, endsAt: null, active: weather !== CLEAR_SKIES };
  }

  if (typeof payload === "object" && !Array.isArray(payload)) {
    // Payload éventuellement enveloppé (`{ weather: { ... } }`).
    const inner =
      payload.weather && typeof payload.weather === "object" && !Array.isArray(payload.weather)
        ? payload.weather
        : payload;

    const id = pickString(inner, ID_KEYS) ?? pickString(payload, ID_KEYS);

    if (id) {
      const weather = formatWeather(id);
      return {
        weather,
        startedAt: pickTimestamp(inner, START_KEYS) ?? pickTimestamp(payload, START_KEYS),
        endsAt: pickTimestamp(inner, END_KEYS) ?? pickTimestamp(payload, END_KEYS),
        active: weather !== CLEAR_SKIES,
      };
    }
  }

  // Forme inattendue : on ne devine pas, on reste sur la dernière valeur connue
  // côté appelant (voir livePoller) plutôt que d'écrire une fausse météo dans
  // l'historique. Un seul log pour ne pas noyer les logs à chaque poll.
  if (!warnedUnknownShape) {
    warnedUnknownShape = true;
    logger.error(
      { payload: JSON.stringify(payload).slice(0, 500) },
      "Unrecognized /platform/v1/weather payload shape — weather updates paused, please update normalizeWeather"
    );
  }

  return { weather: null, startedAt: null, endsAt: null, active: false };
}

export { CLEAR_SKIES };
