// src/core/extractors/mutations.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des mutations dans le bundle.
 */
const SIGNATURES = ["coinMultiplier", "baseChance", 'name:"Gold"'];

/**
 * Extrait les données des mutations du bundle.
 */
export function extractMutations(mainJs) {
  return extractCategoryWithSandbox(mainJs, "mutations", SIGNATURES, buildBaseSandbox).data;
}
