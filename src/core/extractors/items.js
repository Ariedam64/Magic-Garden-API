// src/core/extractors/items.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des items dans le bundle.
 */
const SIGNATURES = ["maxInventoryQuantity", "isOneTimePurchase", "grantedMutation"];

/**
 * Extrait les données des items du bundle.
 */
export function extractItems(mainJs) {
  return extractCategoryWithSandbox(mainJs, "items", SIGNATURES, buildBaseSandbox).data;
}
