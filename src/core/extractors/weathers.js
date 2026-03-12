// src/core/extractors/weathers.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des weathers dans le bundle.
 */
const SIGNATURES = [
  "mutator:{mutation:"
];

/**
 * Extrait les données des weathers du bundle.
 */
export function extractWeathers(mainJs) {
  return extractCategoryWithSandbox(mainJs, "weathers", SIGNATURES, buildBaseSandbox).data;
}
