// src/core/extractors/plants.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox, applyHarvestTypeEnum } from "./sandbox.js";

/**
 * Signatures pour trouver les données des plantes dans le bundle.
 */
const SIGNATURES = ["seed:{tileRef", "plant:{tileRef", "crop:{tileRef"];

/**
 * Extrait les données des plantes du bundle.
 */
export function extractPlants(mainJs) {
  return extractCategoryWithSandbox(
    mainJs,
    "plants",
    SIGNATURES,
    (js, lit) => {
      const sandbox = buildBaseSandbox(js, lit);
      applyHarvestTypeEnum(js, lit, sandbox);
      return sandbox;
    }
  ).data;
}
