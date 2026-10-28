// src/core/extractors/plants.js

import { logger } from "../../logger/index.js";
import {
  extractCategoryWithSandbox,
  findObjectLiteralBySignatures,
  runObjectLiteral,
} from "../game/bundle/extractor.js";
import { buildBaseSandbox, applyHarvestTypeEnum } from "./sandbox.js";

/**
 * Signatures pour trouver les données des plantes dans le bundle.
 */
const SIGNATURES = ["seed:{sprite", "plant:{sprite", "crop:{sprite"];

/**
 * Signatures de la table des positions de fruits (1778, `weatherVisuals-*`) :
 * `{Cabbage:{randomRotation:!1,slots:[{x:0,y:-.05,rotation:0}]},...}`.
 */
export const SLOT_OFFSET_SIGNATURES = ["slots:[{x:", "randomRotation:"];

/**
 * Lit la table des positions de fruits, ou null si la source ne la porte pas.
 */
export function extractSlotOffsets(js) {
  if (!js) return null;
  const hit = findObjectLiteralBySignatures(js, SLOT_OFFSET_SIGNATURES);
  if (!hit) return null;
  return runObjectLiteral(hit.objLiteral, buildBaseSandbox(js, hit.objLiteral));
}

/**
 * Rétablit `slotOffsets` et `rotateSlotOffsetsRandomly`.
 *
 * Depuis 1778 le catalogue ne décrit plus que les emplacements (`growSlots`,
 * qui portent `requiredWeather`/`speciesOverride` chez Thunderspire) et les
 * positions vivent dans une table à part. Les clients lisent toujours
 * `slotOffsets` (nombre de fruits, placement des crops) : fusionner position et
 * emplacement, dans l'ordre, redonne exactement la forme d'avant 1778.
 */
function applySlotOffsets(plants, table) {
  for (const [species, entry] of Object.entries(plants)) {
    const growSlots = entry.plant?.growSlots;
    const layout = table[species];
    if (!Array.isArray(growSlots) || entry.plant.slotOffsets || !layout) continue;

    plants[species] = {
      ...entry,
      plant: {
        ...entry.plant,
        slotOffsets: growSlots.map((slot, i) => ({ ...layout.slots?.[i], ...slot })),
        rotateSlotOffsetsRandomly: layout.randomRotation,
      },
    };
  }
}

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
export function extractPlants(mainJs, _indexJs, _ui, _abilityText, _weathers, _sources, context) {
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

  if (Object.values(plants).some((p) => p.plant?.growSlots && !p.plant.slotOffsets)) {
    const table = extractSlotOffsets(context?.slotOffsetsSource) ?? extractSlotOffsets(mainJs);
    if (table) applySlotOffsets(plants, table);
    else logger.warn("Plant slot offsets table not found in bundle (slotOffsets will be missing)");
  }

  return plants;
}
