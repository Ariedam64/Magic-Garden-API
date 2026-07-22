// src/core/extractors/mutations.js

import {
  extractCategoryWithSandbox,
  findObjectLiteralBySignatures,
  runObjectLiteral,
} from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";
import { logger } from "../../logger/index.js";

/**
 * Signatures pour trouver les données des mutations dans le bundle.
 */
const SIGNATURES = ["coinMultiplier", "baseChance", "name:`Gold`"];

/**
 * Signatures pour trouver la map mutation -> color dans index-*.js.
 */
const MUTATION_COLOR_SIGNATURES = ["Thunderstruck:`rgb(", "Ambershine:`rgb(", "Dawnlit:`rgb("];

const DEFAULT_MUTATION_COLOR = "#969696";

/**
 * Extrait la map mutation -> color, définie comme un simple object literal.
 * Ce bloc a changé d'emplacement plusieurs fois au fil des refontes de build
 * du jeu (index.js -> un chunk dédié partagé avec les couleurs d'abilities).
 * `uiColorsJs` est ce chunk, localisé dynamiquement par `fetchMainBundle` via
 * une recherche dans le graphe de chunks — c'est la source la plus fiable.
 * On garde indexJs en repli si jamais le jeu réintègre ce code ailleurs.
 */
function extractMutationColors(indexJs, uiColorsJs) {
  const hit =
    (uiColorsJs && findObjectLiteralBySignatures(uiColorsJs, MUTATION_COLOR_SIGNATURES)) ||
    (indexJs && findObjectLiteralBySignatures(indexJs, MUTATION_COLOR_SIGNATURES));

  if (!hit) {
    logger.warn("Mutation color map not found in bundle");
    return {};
  }

  try {
    const colors = runObjectLiteral(hit.objLiteral, {});
    logger.debug({ count: Object.keys(colors).length }, "Mutation colors extracted");
    return colors;
  } catch (err) {
    logger.warn({ err: err.message }, "Failed to evaluate mutation color map");
    return {};
  }
}

/**
 * Extrait les données des mutations du bundle.
 */
export function extractMutations(mainJs, indexJs, uiColorsJs) {
  const mutations = extractCategoryWithSandbox(mainJs, "mutations", SIGNATURES, buildBaseSandbox).data;
  const colors = extractMutationColors(indexJs, uiColorsJs);

  for (const [key, mutation] of Object.entries(mutations)) {
    mutation.color = colors[key] || DEFAULT_MUTATION_COLOR;
  }

  return mutations;
}
