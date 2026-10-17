// src/core/extractors/plants.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox, applyHarvestTypeEnum } from "./sandbox.js";

/**
 * Signatures pour trouver les données des plantes dans le bundle.
 */
const SIGNATURES = ["seed:{sprite", "plant:{sprite", "crop:{sprite"];

/**
 * Paires « plante patch -> crop rare » du jeu
 * (`[{patchSpeciesId:"Foxfire",rareCropSpeciesId:"Witchfire"},...]`).
 *
 * Le crop rare est une espèce à part entière dans le catalogue, sans aucun
 * champ qui la relie à sa plante : Witchfire (Divine, 2,5 M) n'est vendue
 * nulle part et ne s'obtient qu'en récoltant un Foxfire. On lit les paires par
 * leurs clés, pas par la forme du tableau qui les porte.
 */
export function extractRareCropPairs(mainJs) {
  const pairs = [];
  for (const m of mainJs.matchAll(
    /patchSpeciesId:[`"']([\w$]+)[`"'],rareCropSpeciesId:[`"']([\w$]+)[`"']/g
  )) {
    pairs.push({ patch: m[1], rareCrop: m[2] });
  }
  return pairs;
}

/**
 * Extrait les données des plantes du bundle.
 *
 * Chaque plante patch reçoit `rareCrop` (son crop rare), et chaque crop rare
 * `rareCropOf` (la plante qui le donne).
 */
export function extractPlants(mainJs) {
  const plants = extractCategoryWithSandbox(
    mainJs,
    "plants",
    SIGNATURES,
    (js, lit) => {
      const sandbox = buildBaseSandbox(js, lit);
      applyHarvestTypeEnum(js, lit, sandbox);
      return sandbox;
    }
  ).data;

  for (const { patch, rareCrop } of extractRareCropPairs(mainJs)) {
    if (plants[patch] && plants[rareCrop]) {
      plants[patch] = { ...plants[patch], rareCrop };
      plants[rareCrop] = { ...plants[rareCrop], rareCropOf: patch };
    }
  }

  return plants;
}
