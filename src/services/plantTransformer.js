// src/services/plantTransformer.js

import { logger } from "../logger/index.js";
import { gameDataService } from "./gameData.js";
import { getAvailableSprites, matchSpriteName } from "../utils/spriteNameMatcher.js";
import { buildSpriteUrl } from "../utils/spriteUrlBuilder.js";

let cachedResult = null;

/**
 * Resolve sprite URL for a tileRef name.
 * For seeds: always use "seeds" category.
 * For plants/crops: check "tallPlants" first, then "plants".
 *
 * @param {string} tileRef - The sprite name (e.g., "Carrot", "StarweaverPlant")
 * @param {"seed"|"plant"|"crop"} type - The plant part type
 * @returns {string|null} The sprite URL or null if not found
 */
function resolveSpriteUrl(tileRef, type, spriteVersion) {
  if (!tileRef || typeof tileRef !== "string") {
    return null;
  }

  // Seeds always use the "seeds" category
  if (type === "seed") {
    const spriteName = matchSpriteName(tileRef, "seeds");
    return spriteName ? buildSpriteUrl("seeds", spriteName, { version: spriteVersion }) : null;
  }

  // For plants and crops, check tallPlants first, then plants
  const tallPlantsSprites = getAvailableSprites("tallPlants");
  const tallPlantsMatch = tallPlantsSprites.find(
    (s) => s.toLowerCase() === tileRef.toLowerCase()
  );

  if (tallPlantsMatch) {
    return buildSpriteUrl("tallPlants", tallPlantsMatch, { version: spriteVersion });
  }

  // Fallback to plants category
  const spriteName = matchSpriteName(tileRef, "plants");
  return spriteName ? buildSpriteUrl("plants", spriteName, { version: spriteVersion }) : null;
}

/**
 * Transform a plant part (seed, plant, or crop) by replacing tileRef with sprite.
 *
 * @param {Object} partData - The part data object
 * @param {"seed"|"plant"|"crop"} type - The plant part type
 * @returns {Object} Transformed part data
 */
function transformPlantPart(partData, type, spriteVersion) {
  if (!partData || typeof partData !== "object") {
    return partData;
  }

  const transformed = { ...partData };

  // Replace tileRef with sprite URL
  if (transformed.tileRef !== undefined) {
    const sprite = resolveSpriteUrl(transformed.tileRef, type, spriteVersion);
    delete transformed.tileRef;
    transformed.sprite = sprite;
  }

  // Also handle immatureTileRef if present (for plants like Starweaver)
  if (transformed.immatureTileRef !== undefined) {
    const immatureSprite = resolveSpriteUrl(transformed.immatureTileRef, "plant", spriteVersion);
    delete transformed.immatureTileRef;
    transformed.immatureSprite = immatureSprite;
  }

  // Handle topmostLayerTileRef if present
  if (transformed.topmostLayerTileRef !== undefined) {
    const topmostSprite = resolveSpriteUrl(transformed.topmostLayerTileRef, "plant", spriteVersion);
    delete transformed.topmostLayerTileRef;
    transformed.topmostLayerSprite = topmostSprite;
  }

  // Handle activeState.tileRef if present
  if (transformed.activeState && transformed.activeState.tileRef !== undefined) {
    const activeStateSprite = resolveSpriteUrl(
      transformed.activeState.tileRef,
      "plant",
      spriteVersion
    );
    transformed.activeState = {
      ...transformed.activeState,
      sprite: activeStateSprite,
    };
    delete transformed.activeState.tileRef;
  }

  return transformed;
}

/**
 * Transform a complete plant entry (seed, plant, crop).
 *
 * @param {Object} plantData - The plant data object
 * @returns {Object} Transformed plant data
 */
function transformPlant(plantData, spriteVersion) {
  if (!plantData || typeof plantData !== "object") {
    return plantData;
  }

  const transformed = {};

  if (plantData.seed) {
    transformed.seed = transformPlantPart(plantData.seed, "seed", spriteVersion);
  }

  if (plantData.plant) {
    transformed.plant = transformPlantPart(plantData.plant, "plant", spriteVersion);
  }

  if (plantData.crop) {
    transformed.crop = transformPlantPart(plantData.crop, "crop", spriteVersion);
  }

  return transformed;
}

/**
 * Get transformed plants with sprite URLs.
 *
 * @returns {Object} Plants data with sprite URLs instead of tileRef
 */
export async function getTransformedPlants(options = {}) {
  const { spriteVersion = null } = options;
  try {
    const plants = await gameDataService.getPlants();

    if (!plants || Object.keys(plants).length === 0) {
      logger.warn("No plants data available");
      cachedResult = {};
      return cachedResult;
    }

    // Transform each plant
    const transformed = {};
    for (const [key, value] of Object.entries(plants)) {
      transformed[key] = transformPlant(value, spriteVersion);
    }

    cachedResult = transformed;

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

/**
 * Invalidate cache (called when bundle version changes).
 */
export function invalidatePlantCache() {
  cachedResult = null;
  logger.debug("Plant transform cache invalidated");
}
