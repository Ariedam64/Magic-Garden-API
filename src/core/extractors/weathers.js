// src/core/extractors/weathers.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des weathers dans le bundle.
 */
export const WEATHER_SIGNATURES = [
  "mutator:{mutation:"
];

/**
 * Extrait les données des weathers du bundle.
 *
 * Le catalogue météo ne vit plus forcément dans le chunk de données : en 1280
 * (2026-09-24) il est passé de `sendQuinoaRpc-*` à `bootScreen-*`, et
 * /data/weathers est resté en 500 toute une nuit. Le résolveur repère donc son
 * chunk à part (`weathersSource`), comme pour les couleurs ; le chunk de
 * données reste le repli quand les deux coïncident.
 */
export function extractWeathers(mainJs, _indexJs, _uiColorsSources, _abilityTextSource, weathersSource) {
  return extractCategoryWithSandbox(weathersSource ?? mainJs, "weathers", WEATHER_SIGNATURES, buildBaseSandbox).data;
}
