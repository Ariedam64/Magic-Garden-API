// src/core/extractors/decor.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des décorations dans le bundle.
 */
const SIGNATURES = ["baseTileScale", "isOneTimePurchase", "rotationVariants"];

/**
 * Extrait les données des décorations du bundle.
 */
export function extractDecor(mainJs) {
  return extractCategoryWithSandbox(mainJs, "decor", SIGNATURES, buildBaseSandbox).data;
}
