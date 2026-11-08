// src/services/plantTransformer.js

import { logger } from "../logger/index.js";
import { gameDataService } from "./gameData.js";
import { liveDataService } from "./liveData.js";
import { resolveSpritePathsDeep } from "../utils/spritePathResolver.js";

/**
 * Transform a plant part (seed, plant, or crop).
 *
 * Les sprites d'une plante sont éparpillés — `sprite`, `immatureSprite`,
 * `topmostLayerSprite`, `activeState.sprite` chez les célestes — et le jeu en
 * ajoute au fil des mises à jour. On résout donc sur la valeur plutôt que sur
 * une liste de champs à tenir à jour.
 */
function transformPlantPart(partData, spriteVersion) {
  if (!partData || typeof partData !== "object") {
    return partData;
  }

  return resolveSpritePathsDeep(partData, { version: spriteVersion });
}

/**
 * Transform a complete plant entry (seed, plant, crop).
 */
function transformPlant(plantData, spriteVersion) {
  if (!plantData || typeof plantData !== "object") {
    return plantData;
  }

  // Les champs de premier niveau (`name`, `rareCrop`, `rareCropOf`…) passent
  // tels quels : seuls les trois stades portent des sprites à résoudre.
  const { seed: _seed, plant: _plant, crop: _crop, ...rest } = plantData;
  const transformed = { ...rest };

  if (plantData.seed) {
    transformed.seed = transformPlantPart(plantData.seed, spriteVersion);
  }

  if (plantData.plant) {
    transformed.plant = transformPlantPart(plantData.plant, spriteVersion);
  }

  if (plantData.crop) {
    transformed.crop = transformPlantPart(plantData.crop, spriteVersion);
  }

  return transformed;
}

/**
 * Enrichit les plantes transformées avec le flag `purchasable` sur chaque seed.
 * Compare les clés des plantes avec les graines proposées par les boutiques
 * ouvertes (le shop `seed`, mais aussi les shops d'évènement).
 * Si les données du shop ne sont pas disponibles, `purchasable` vaut null.
 */
export function enrichPlantsWithPurchasable(plants) {
  const shopSpecies = liveDataService.getShopSeedSpecies();

  const enriched = {};
  for (const [key, plant] of Object.entries(plants)) {
    if (!plant.seed) {
      enriched[key] = plant;
      continue;
    }

    enriched[key] = {
      ...plant,
      seed: {
        ...plant.seed,
        purchasable: shopSpecies ? shopSpecies.has(key) : null,
      },
    };
  }

  return enriched;
}

/**
 * Get transformed plants with sprite URLs.
 */
export async function getTransformedPlants(options = {}) {
  const { spriteVersion = null } = options;
  // Pas de try/catch : comme pour les autres catégories, une extraction que le
  // jeu vient de casser doit remonter (500, signalée par /health) au lieu de se
  // servir et de se mettre en cache comme un catalogue vide en 200.
  const plants = await gameDataService.getPlants();

  if (!plants || Object.keys(plants).length === 0) {
    logger.warn("No plants data available");
    return {};
  }

  const transformed = {};
  for (const [key, value] of Object.entries(plants)) {
    transformed[key] = transformPlant(value, spriteVersion);
  }

  logger.debug(
    { count: Object.keys(transformed).length },
    "Plants data transformed with sprites"
  );

  return transformed;
}
