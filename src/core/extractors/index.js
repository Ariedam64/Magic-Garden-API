// src/core/extractors/index.js

import { extractPlants } from "./plants.js";
import { extractPets } from "./pets.js";
import { extractItems } from "./items.js";
import { extractDecor } from "./decor.js";
import { extractEggs } from "./eggs.js";
import { extractAbilities } from "./abilities.js";
import { extractMutations } from "./mutations.js";
import { extractWeathers } from "./weathers.js";
import {
  buildBaseSandbox,
  applyRarityEnum,
  applyWeatherEnums,
  applyHarvestTypeEnum,
} from "./sandbox.js";

// Re-exports
export {
  extractPlants,
  extractPets,
  extractItems,
  extractDecor,
  extractEggs,
  extractAbilities,
  extractMutations,
  extractWeathers,
  buildBaseSandbox,
  applyRarityEnum,
  applyWeatherEnums,
  applyHarvestTypeEnum,
};

/**
 * Registry des extracteurs disponibles.
 * Clé = nom de la catégorie, Valeur = fonction d'extraction.
 */
export const ExtractorRegistry = {
  plants: extractPlants,
  pets: extractPets,
  items: extractItems,
  decor: extractDecor,
  eggs: extractEggs,
  abilities: extractAbilities,
  mutations: extractMutations,
  weathers: extractWeathers,
};

/**
 * Retourne la liste des catégories disponibles.
 */
export function getAvailableCategories() {
  return Object.keys(ExtractorRegistry);
}
