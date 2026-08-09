// src/core/extractors/mutations.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { extractColorMapping, applyColors } from "../game/bundle/colors.js";
import { MUTATION_COLOR_NAMES, COLOR_MIN_HITS } from "../game/bundle/colorNames.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des mutations dans le bundle.
 */
const SIGNATURES = ["coinMultiplier", "baseChance", "name:`Gold`"];

const DEFAULT_MUTATION_COLOR = "#969696";

/**
 * Extrait les données des mutations du bundle.
 *
 * Comme pour les abilities, la map de couleurs vit dans un bloc UI séparé qui
 * change de chunk et de forme au fil des builds : localisation et parsing sont
 * délégués à `bundle/colors.js`.
 */
export function extractMutations(mainJs, indexJs, uiColorsSources) {
  const mutations = extractCategoryWithSandbox(mainJs, "mutations", SIGNATURES, buildBaseSandbox).data;

  const sources = [...(Array.isArray(uiColorsSources) ? uiColorsSources : [uiColorsSources]), indexJs, mainJs];
  const { colors, defaultColor } = extractColorMapping(sources, {
    names: MUTATION_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
    label: "mutations",
  });

  return applyColors(mutations, colors, defaultColor?.solid ?? DEFAULT_MUTATION_COLOR, "mutations");
}
