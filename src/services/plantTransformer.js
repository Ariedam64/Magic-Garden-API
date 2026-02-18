// src/services/plantTransformer.js

import { logger } from "../logger/index.js";
import { gameDataService } from "./gameData.js";
import { resolveSpritePath } from "../utils/spritePathResolver.js";

/**
 * Convertit un champ sprite path en URL si c'est un path du bundle.
 */
function resolveSpriteField(value, spriteVersion) {
  if (typeof value === "string" && value.startsWith("sprite/")) {
    return resolveSpritePath(value, { version: spriteVersion });
  }
  return value ?? null;
}

/**
 * Transform a plant part (seed, plant, or crop).
 * Converts sprite paths to URLs for: sprite, immatureSprite,
 * topmostLayerSprite, activeState.sprite.
 */
function transformPlantPart(partData, spriteVersion) {
  if (!partData || typeof partData !== "object") {
    return partData;
  }

  const transformed = { ...partData };

  for (const field of ["sprite", "immatureSprite", "topmostLayerSprite"]) {
    if (transformed[field] !== undefined) {
      transformed[field] = resolveSpriteField(transformed[field], spriteVersion);
    }
  }

  if (transformed.activeState?.sprite !== undefined) {
    transformed.activeState = {
      ...transformed.activeState,
      sprite: resolveSpriteField(transformed.activeState.sprite, spriteVersion),
    };
  }

  return transformed;
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
