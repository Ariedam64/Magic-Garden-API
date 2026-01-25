// src/services/assetData.js

// Re-export des fonctions d'assets existantes
// On garde les fichiers existants car ils sont bien structurés

import { getSpritesPayload } from "../assets/sprites/sprites.js";
import { getCosmeticsPayload } from "../assets/cosmetics/cosmetics.js";
import { getAudioPayload } from "../assets/audios/audio.js";

/**
 * Service pour les assets du jeu (sprites, cosmetics, audio).
 */
export const assetDataService = {
  /**
   * Récupère les données des sprites.
   */
  async getSprites(options = {}) {
    return getSpritesPayload(options);
  },

  /**
   * Récupère les données des cosmétiques.
   */
  async getCosmetics(options = {}) {
    return getCosmeticsPayload(options);
  },

  /**
   * Récupère les données audio.
   */
  async getAudio() {
    return getAudioPayload();
  },
};
