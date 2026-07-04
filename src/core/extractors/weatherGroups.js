// src/core/extractors/weatherGroups.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver le moteur de scheduling météo (par groupe:
 * Hydro/Lunar) dans le bundle. Distinct de weathers.js, qui extrait les
 * définitions par weather individuelle (Rain, Frost, ...).
 */
const SIGNATURES = [
  "randomTimeSlots:{minFrequencyMinutes:",
  "dropTable:[{weatherId:",
  "fixedTimeSlots:[",
];

/**
 * Extrait les groupes de weather (durée, fréquence/slots, drop table pondérée)
 * du bundle.
 */
export function extractWeatherGroups(mainJs) {
  return extractCategoryWithSandbox(mainJs, "weatherGroups", SIGNATURES, buildBaseSandbox).data;
}
