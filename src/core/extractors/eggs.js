// src/core/extractors/eggs.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des œufs dans le bundle.
 */
const SIGNATURES = ["secondsToHatch", "faunaSpawnWeights", "coinPrice"];

/**
 * Extrait les données des œufs du bundle.
 */
export function extractEggs(mainJs) {
  return extractCategoryWithSandbox(mainJs, "eggs", SIGNATURES, buildBaseSandbox).data;
}
