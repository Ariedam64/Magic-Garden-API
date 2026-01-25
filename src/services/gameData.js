// src/services/gameData.js

import { getCategoryCached } from "../core/game/cache.js";
import {
  extractPlants,
  extractPets,
  extractItems,
  extractDecor,
  extractEggs,
  extractAbilities,
  extractMutations,
  ExtractorRegistry,
} from "../core/extractors/index.js";
import { logger } from "../logger/index.js";

/**
 * Service pour les données statiques du jeu (extraites du bundle).
 */
export const gameDataService = {
  /**
   * Récupère les données des plantes.
   */
  async getPlants() {
    return getCategoryCached("plants", extractPlants);
  },

  /**
   * Récupère les données des pets.
   */
  async getPets() {
    return getCategoryCached("pets", extractPets);
  },

  /**
   * Récupère les données des items.
   */
  async getItems() {
    return getCategoryCached("items", extractItems);
  },

  /**
   * Récupère les données des décorations.
   */
  async getDecor() {
    return getCategoryCached("decor", extractDecor);
  },

  /**
   * Récupère les données des œufs.
   */
  async getEggs() {
    return getCategoryCached("eggs", extractEggs);
  },

  /**
   * Récupère les données des abilities.
   */
  async getAbilities() {
    return getCategoryCached("abilities", extractAbilities);
  },

  /**
   * Récupère les données des mutations.
   */
  async getMutations() {
    return getCategoryCached("mutations", extractMutations);
  },

  /**
   * Récupère les données d'une catégorie par son nom.
   */
  async getCategory(name) {
    const extractor = ExtractorRegistry[name];
    if (!extractor) {
      throw new Error(`Unknown category: ${name}`);
    }
    return getCategoryCached(name, extractor);
  },

  /**
   * Récupère toutes les catégories disponibles.
   */
  getAvailableCategories() {
    return Object.keys(ExtractorRegistry);
  },
};
