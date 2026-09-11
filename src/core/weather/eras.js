// src/core/weather/eras.js

import { DAY_MS, dayKeyToMs } from "./days.js";

/**
 * Registre des rulesets météo ("ères") et faits historiques associés.
 *
 * C'est de la **donnée maintenue à la main** : le jeu ne versionne pas son
 * scheduler, on constate un changement de comportement dans l'historique
 * enregistré et on ajoute une entrée.
 *
 * Depuis la v1141 du jeu (2026-09-11), ce registre est aussi la **seule**
 * source du moteur : le bundle client ne porte plus les créneaux ni les drop
 * tables, donc `/data/weather-groups` est servi d'ici et la dérive ne se
 * détecte plus que par `/weather-station/accuracy`.
 */

/** Libellé public par id interne du jeu (mêmes conventions que `/data/weathers`). */
export const WEATHER_DISPLAY = {
  Rain: "Rain",
  Frost: "Snow",
  Thunderstorm: "Thunderstorm",
  Dawn: "Dawn",
  AmberMoon: "Amber Moon",
};

/** Libellé du "hors évènement", cohérent avec `/live/weather` et l'historique. */
export const CLEAR_SKIES = "Clear Skies";

/**
 * L'historique a stocké certaines météos sous deux clés (le jeu a émis
 * `"Amber Moon"` avant `"AmberMoon"`). On canonicalise avant toute comparaison
 * moteur/historique pour ne pas compter deux fois la même météo.
 */
const WEATHER_ALIASES = {
  [CLEAR_SKIES]: "Sunny",
  "Amber Moon": "AmberMoon",
};

export function canonicalWeatherKey(name) {
  return WEATHER_ALIASES[name] || name;
}

function hydro(dropTable, durationMinutes, minFrequencyMinutes, maxFrequencyMinutes) {
  return { durationMinutes, randomTimeSlots: { minFrequencyMinutes, maxFrequencyMinutes }, dropTable };
}

const LUNAR = {
  durationMinutes: 10,
  fixedTimeSlots: [0, 48, 96, 144, 192, 240],
  dropTable: [{ weatherId: "Dawn", weight: 67 }, { weatherId: "AmberMoon", weight: 33 }],
};

/**
 * Lunar v4 : les 6 slots fixes ne sont plus 6 tirages 67/33 indépendants sur le
 * rng du jour mais une **distribution de deck**. Sur un cycle de 3 jours, chacun
 * des 6 slots reçoit Amber Moon exactement une fois ; un rng propre au cycle
 * choisit la répartition entre les jours et mélange l'ordre des slots. Même taux
 * de 33% à long terme, mais plus i.i.d. — c'est précisément ce qui faisait
 * dériver v3.
 */
export const DECK_SEED_NS = "quinoa-weather-deck";

const LUNAR_DECK = {
  ...LUNAR,
  deck: {
    cycleDays: 3,
    dealtWeatherId: "AmberMoon",
    baseWeatherId: "Dawn",
    splits: [[2, 2, 2], [1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]],
  },
};

/**
 * Une entrée par ruleset historique, du plus récent au plus ancien, avec des
 * bornes à la minute quand la transition a eu lieu en cours de journée.
 */
const ERAS_RAW = [
  {
    id: "v4",
    label: "v4 · Lunar dealt from a 3-day deck (Hydro unchanged)",
    from: "2026-08-28T20:00:00Z",
    to: null,
    groups: {
      Hydro: hydro([{ weatherId: "Rain", weight: 50 }, { weatherId: "Frost", weight: 30 }, { weatherId: "Thunderstorm", weight: 20 }], 10, 40, 60),
      Lunar: LUNAR_DECK,
    },
  },
  {
    id: "v3",
    label: "v3 · Rain-heavy, 10min Hydro, every 40-60min",
    from: "2026-07-01T23:30:00Z",
    to: "2026-08-28T20:00:00Z",
    groups: {
      Hydro: hydro([{ weatherId: "Rain", weight: 50 }, { weatherId: "Frost", weight: 30 }, { weatherId: "Thunderstorm", weight: 20 }], 10, 40, 60),
      Lunar: LUNAR,
    },
  },
  {
    id: "v2",
    label: "v2 · Rain-heavy, 5min Hydro, every 20-35min",
    from: "2026-03-06",
    to: "2026-07-01T23:30:00Z",
    groups: {
      Hydro: hydro([{ weatherId: "Rain", weight: 50 }, { weatherId: "Frost", weight: 30 }, { weatherId: "Thunderstorm", weight: 20 }], 5, 20, 35),
      Lunar: LUNAR,
    },
  },
  {
    id: "v1",
    label: "v1 · Frost-heavy, 5min Hydro, every 20-35min",
    from: "2026-02-20",
    to: "2026-03-06",
    groups: {
      Hydro: hydro([{ weatherId: "Rain", weight: 30 }, { weatherId: "Frost", weight: 50 }, { weatherId: "Thunderstorm", weight: 20 }], 5, 20, 35),
      Lunar: LUNAR,
    },
  },
];

export const ERAS = ERAS_RAW.map((era) => ({
  ...era,
  fromMs: new Date(era.from).getTime(),
  toMs: era.to === null ? null : new Date(era.to).getTime(),
}));

/** Première date modélisée : avant, le moteur ne prédit rien plutôt que d'inventer. */
export const MODELED_FROM = ERAS[ERAS.length - 1].from.slice(0, 10);

/**
 * Signature du registre : entre dans les ETag pour qu'un ajout d'ère invalide
 * les réponses mises en cache côté client.
 */
export const ENGINE_SIGNATURE = ERAS.map((era) => `${era.id}@${era.from}`).join(",");

/**
 * Faits réels qu'aucun ruleset ne reproduit — ils ne font partie d'aucune ère,
 * donc ne s'appliquent qu'en mode auto (ce qui s'est réellement passé). Forcer
 * une ère simule ce ruleset seul.
 *
 * Format : `[startSlot, slotCount, weatherId]`, `weatherId` valant
 * `"Thunderstorm"` par défaut (raccourci historique) ou `null` pour vider.
 */
export const REALITY_PATCHES = {
  "2026-06-26": [[219, 1], [231, 1]],
  // Évènement Amber Moon : le jeu force chaque slot Lunar de
  // [2026-08-28 20:00Z, 2026-08-29 17:00Z) à Amber Moon, deck ignoré. Slot 240 =
  // 20:00 le 28 ; 0/48/96/144/192 = 00:00-16:00 le 29 (20:00 le 29 est hors
  // fenêtre et repasse donc au deck).
  "2026-08-28": [[240, 2, "AmberMoon"]],
  "2026-08-29": [[0, 2, "AmberMoon"], [48, 2, "AmberMoon"], [96, 2, "AmberMoon"], [144, 2, "AmberMoon"], [192, 2, "AmberMoon"]],
};

/** L'ère active au 00:00 UTC d'un jour donné (`null` si non modélisé). */
export function eraFor(dayKey) {
  const ms = dayKeyToMs(dayKey);
  for (const era of ERAS) {
    if (ms >= era.fromMs && (era.toMs === null || ms < era.toMs)) return era;
  }
  return null;
}

export function eraById(id) {
  return ERAS.find((era) => era.id === id) || null;
}

/** L'ère active à un instant quelconque (`null` si non modélisé). */
export function eraAt(ms) {
  for (const era of ERAS) {
    if (ms >= era.fromMs && (era.toMs === null || ms < era.toMs)) return era;
  }
  return null;
}

/**
 * Les ères couvrant un jour UTC, découpées sur la fenêtre [00:00, 24:00) de ce
 * jour. La plupart des jours en renvoient une seule ; un jour de transition en
 * renvoie deux ou plus, dans l'ordre chronologique.
 */
export function erasForDay(dayKey) {
  const dayStart = dayKeyToMs(dayKey);
  const dayEnd = dayStart + DAY_MS;
  const segments = [];

  for (const era of ERAS) {
    const from = Math.max(dayStart, era.fromMs);
    const to = era.toMs === null ? dayEnd : Math.min(dayEnd, era.toMs);
    if (from < to) segments.push({ era, fromMs: from, toMs: to });
  }

  segments.sort((a, b) => a.fromMs - b.fromMs);
  return segments;
}

/**
 * Table `weatherId -> groupe` (Hydro/Lunar) déduite des drop tables d'une ère,
 * pour ne pas maintenir un second mapping en parallèle.
 */
export function groupIndex(groups) {
  const index = {};
  for (const [groupName, group] of Object.entries(groups || {})) {
    for (const drop of group.dropTable || []) index[drop.weatherId] = groupName;
    if (group.deck) {
      index[group.deck.dealtWeatherId] = groupName;
      index[group.deck.baseWeatherId] = groupName;
    }
  }
  return index;
}
