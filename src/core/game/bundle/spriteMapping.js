// src/core/game/bundle/spriteMapping.js

import { findObjectLiteralBySignatures, runObjectLiteral } from "./extractor.js";
import { makeGlobalSandboxProxy } from "./sandbox.js";

/**
 * Signatures stables pour localiser l'objet sprite mapping dans le bundle.
 * Ces strings littérales ne changent jamais après minification.
 */
const SPRITE_MAPPING_SIGNATURES = [
  '"sprite/seed/',
  '"sprite/plant/',
  '"sprite/pet/',
  '"sprite/decor/',
];

/** Clés attendues dans l'objet sprite mapping pour validation. */
const REQUIRED_KEYS = ["Seed", "Plant", "Pet", "Decor"];

let cache = null;

/**
 * Extrait l'objet sprite mapping du bundle.
 *
 * @param {string} mainJs - Contenu du bundle
 * @returns {{ varName: string, mapping: object } | null}
 */
export function extractSpriteMapping(mainJs) {
  if (cache) return cache;

  const hit = findObjectLiteralBySignatures(mainJs, SPRITE_MAPPING_SIGNATURES);
  if (!hit) return null;

  const sandbox = makeGlobalSandboxProxy();
  const mapping = runObjectLiteral(hit.objLiteral, sandbox);

  if (!mapping || typeof mapping !== "object") return null;

  // Validation : vérifie que les clés attendues existent
  const valid = REQUIRED_KEYS.every(
    (k) => k in mapping && typeof mapping[k] === "object"
  );
  if (!valid) return null;

  cache = { varName: hit.varName, mapping };
  return cache;
}

/**
 * Vide le cache du sprite mapping.
 */
export function clearSpriteMappingCache() {
  cache = null;
}
