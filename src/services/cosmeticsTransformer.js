// src/services/cosmeticsTransformer.js

import { gameDataService } from "./gameData.js";
import { transformDataWithSprites } from "./dataTransformer.js";
import { getCosmeticsPayload } from "../assets/cosmetics/cosmetics.js";
import { logger } from "../logger/index.js";

/**
 * Catalogues de cosmétiques enrichis de leurs images.
 *
 * Les accessoires de pets sont dans les atlas (`sprite/pet-cosmetic/*`) : le
 * transformer de sprites habituel suffit. Les tenues d'avatar et le cosmétique
 * offert par un pack sont des PNG du bundle `cosmetic` du manifest, déjà listés
 * par `/assets/cosmetics` : on réutilise ces URL plutôt que d'en reconstruire.
 */

async function cosmeticImageIndex() {
  try {
    const { categories } = await getCosmeticsPayload({ full: true });
    const index = new Map();
    for (const { items } of categories) {
      for (const item of items) index.set(`${item.base}.png`, item.url);
    }
    return index;
  } catch (err) {
    // Les données restent utiles sans images : on ne fait pas échouer la route.
    logger.warn({ error: err?.message }, "Cosmetic images unavailable, serving catalog without URLs");
    return new Map();
  }
}

export async function getTransformedPetCosmetics({ spriteVersion = null } = {}) {
  const data = await gameDataService.getPetCosmetics();
  return transformDataWithSprites(data, "petCosmetics", { spriteVersion });
}

export async function getTransformedAvatarCosmetics() {
  const [data, images] = await Promise.all([gameDataService.getAvatarCosmetics(), cosmeticImageIndex()]);

  const out = {};
  for (const [id, entry] of Object.entries(data)) {
    out[id] = {
      ...entry,
      url: images.get(entry.filename) ?? null,
      ...(entry.bodyArt ? { bodyArtUrl: images.get(entry.bodyArt) ?? null } : {}),
    };
  }
  return out;
}

export async function getTransformedBundles() {
  const [data, images] = await Promise.all([gameDataService.getBundles(), cosmeticImageIndex()]);

  const out = {};
  for (const [id, offer] of Object.entries(data)) {
    out[id] = {
      ...offer,
      ...(offer.cosmeticFilename ? { cosmeticUrl: images.get(offer.cosmeticFilename) ?? null } : {}),
    };
  }
  return out;
}
