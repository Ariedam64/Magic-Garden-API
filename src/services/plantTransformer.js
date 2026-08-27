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

  const transformed = {};

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
 * Compare les clés des plantes avec les species listées dans le shop.
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
  try {
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
  } catch (err) {
    logger.error({ error: err.message }, "Error retrieving plants");
    return {};
  }
}
