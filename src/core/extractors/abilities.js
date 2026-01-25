// src/core/extractors/abilities.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des abilities dans le bundle.
 */
const SIGNATURES = ['trigger:"continuous"', "baseProbability", "baseParameters:{"];

/**
 * Extrait les données des abilities du bundle.
 */
export function extractAbilities(mainJs) {
  return extractCategoryWithSandbox(mainJs, "abilities", SIGNATURES, buildBaseSandbox).data;
}
