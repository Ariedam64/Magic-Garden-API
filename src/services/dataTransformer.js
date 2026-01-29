/**
 * Generic data transformer with sprite URLs
 * Handles decor, eggs, items, mutations, and pets
 */

import { matchSpriteName } from "../utils/spriteNameMatcher.js";
import { buildSpriteUrl } from "../utils/spriteUrlBuilder.js";
import { logger } from "../logger/index.js";

/**
 * Transform a single item by replacing tileRef with sprite URL
 * @param {string} itemKey - Item key (e.g., "SmallRock")
 * @param {Object} itemData - Item data object
 * @param {string} spriteCategory - Sprite category (decor, items, pets, mutations)
 * @returns {Object} Transformed item data
 */
function transformItem(itemKey, itemData, spriteCategory, spriteVersion) {
  if (!itemData || typeof itemData !== "object") {
    return itemData;
  }

  const transformed = { ...itemData };

  // Match sprite name
  const spriteName = matchSpriteName(itemKey, spriteCategory);

  // Replace tileRef with sprite
  if (transformed.tileRef !== undefined) {
    delete transformed.tileRef;
    transformed.sprite = spriteName
      ? buildSpriteUrl(spriteCategory, spriteName, { version: spriteVersion })
      : null;
  }

  return transformed;
}

/**
 * Transform mutations
 * @param {string} mutationKey - Mutation key (e.g., "Chilled")
 * @param {Object} mutationData - Mutation data object
 * @returns {Object} Transformed mutation data
 */
function transformMutation(mutationKey, mutationData, spriteVersion) {
  if (!mutationData || typeof mutationData !== "object") {
    return mutationData;
  }

  const transformed = { ...mutationData };

  // Match sprite name
  const spriteName = matchSpriteName(mutationKey, "mutations");

  // Replace tileRef with sprite
  if (transformed.tileRef !== undefined) {
    delete transformed.tileRef;
    transformed.sprite = spriteName
      ? buildSpriteUrl("mutations", spriteName, { version: spriteVersion })
      : null;
  }

  return transformed;
}

/**
 * Transform pets (all pets use "pets" folder regardless of tileTransformOrigin)
 * @param {string} petKey - Pet key (e.g., "Worm")
 * @param {Object} petData - Pet data object
 * @returns {Object} Transformed pet data
 */
function transformPet(petKey, petData, spriteVersion) {
  if (!petData || typeof petData !== "object") {
    return petData;
  }

  const transformed = { ...petData };

  // All pets use the "pets" sprite category
  const category = "pets";

  // Match sprite name
  const spriteName = matchSpriteName(petKey, category);

  // Replace tileRef with sprite
  if (transformed.tileRef !== undefined) {
    delete transformed.tileRef;
    transformed.sprite = spriteName
      ? buildSpriteUrl(category, spriteName, { version: spriteVersion })
      : null;
  }

  return transformed;
}

/**
 * Build sprite URL from iconSpriteKey (e.g., "sprite/ui/FrostIcon").
 * @param {string} iconSpriteKey - Icon sprite key from bundle
 * @returns {string|null} Sprite URL
 */
function buildWeatherSprite(iconSpriteKey, spriteVersion) {
  if (!iconSpriteKey || typeof iconSpriteKey !== "string") {
    return null;
  }

  const match = iconSpriteKey.match(/^sprite\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return null;
  }

  const [, category, spriteName] = match;
  return buildSpriteUrl(category, spriteName, { version: spriteVersion });
}

/**
 * Transform a single weather entry by replacing iconSpriteKey with sprite URL
 * @param {string} weatherKey - Weather key (e.g., "Rain")
 * @param {Object} weatherData - Weather data object
 * @returns {Object} Transformed weather data
 */
function transformWeather(weatherKey, weatherData, spriteVersion) {
  if (!weatherData || typeof weatherData !== "object") {
    return weatherData;
  }

  const transformed = { ...weatherData };
  const sprite = buildWeatherSprite(transformed.iconSpriteKey, spriteVersion);

  if ("iconSpriteKey" in transformed) {
    delete transformed.iconSpriteKey;
  }

  transformed.sprite = sprite;

  return transformed;
}

/**
 * Transform all items in a category
 * @param {Object} data - Complete data object
 * @param {string} category - Category type (decor, eggs, items, mutations, pets)
 * @returns {Object} Transformed data
 */
export function transformDataWithSprites(data, category, options = {}) {
  const { spriteVersion = null } = options;
  if (!data || typeof data !== "object") {
    return {};
  }

  const transformed = {};

  for (const [key, value] of Object.entries(data)) {
    try {
      // Use specialized transformer based on category
      if (category === "mutations") {
        transformed[key] = transformMutation(key, value, spriteVersion);
      } else if (category === "pets") {
        transformed[key] = transformPet(key, value, spriteVersion);
      } else {
        // For eggs, use pets folder
        const spriteCategory = category === "eggs" ? "pets" : category;
        transformed[key] = transformItem(key, value, spriteCategory, spriteVersion);
      }
    } catch (error) {
      logger.error(`Error transforming ${category} ${key}:`, error);
      // Include original data if transformation fails
      transformed[key] = value;
    }
  }

  return transformed;
}

/**
 * Transform weather data by replacing iconSpriteKey with sprite URLs
 * and ensuring a default Sunny weather exists.
 * @param {Object} data - Complete weather data object
 * @returns {Object} Transformed weather data
 */
export function transformWeathersWithSprites(data, options = {}) {
  const { spriteVersion = null } = options;
  const transformed = {};

  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      try {
        transformed[key] = transformWeather(key, value, spriteVersion);
      } catch (error) {
        logger.error(`Error transforming weather ${key}:`, error);
        transformed[key] = value;
      }
    }
  }

  if (!("Sunny" in transformed)) {
    transformed.Sunny = transformWeather(
      "Sunny",
      {
        name: "Sunny",
        iconSpriteKey: "sprite/ui/SunnyIcon",
      },
      spriteVersion
    );
  }

  return transformed;
}

/**
 * Get transformation statistics
 * @param {Object} originalData - Original data
 * @param {Object} transformedData - Transformed data
 * @returns {Object} Statistics object
 */
export function getTransformationStats(originalData, transformedData) {
  let totalItems = 0;
  let itemsWithSprites = 0;
  let itemsWithoutSprites = 0;

  for (const [key, value] of Object.entries(transformedData)) {
    totalItems++;
    if (value.sprite) {
      itemsWithSprites++;
    } else {
      itemsWithoutSprites++;
    }
  }

  return {
    totalItems,
    itemsWithSprites,
    itemsWithoutSprites,
    matchRate: totalItems > 0 ? (itemsWithSprites / totalItems) * 100 : 0,
  };
}
