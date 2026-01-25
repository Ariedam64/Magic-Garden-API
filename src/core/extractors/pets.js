// src/core/extractors/pets.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des pets dans le bundle.
 */
const SIGNATURES = ["coinsToFullyReplenishHunger", "innateAbilityWeights", "hoursToMature"];

/**
 * Extrait les données des pets du bundle.
 */
export function extractPets(mainJs) {
  return extractCategoryWithSandbox(mainJs, "pets", SIGNATURES, buildBaseSandbox).data;
}
