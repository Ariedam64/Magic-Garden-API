/**
 * Generic data transformer with sprite URLs.
 * Converts sprite paths from the bundle (e.g. "sprite/seed/Carrot")
 * into serving URLs (e.g. "/assets/sprites/seeds/Carrot.png").
 */

import { resolveSpritePath } from "../utils/spritePathResolver.js";
import { logger } from "../logger/index.js";

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
 * Transform a single data item: convert sprite paths to URLs.
 */
function transformItem(itemKey, itemData, spriteVersion) {
  if (!itemData || typeof itemData !== "object") {
    return itemData;
  }

  const transformed = { ...itemData };

  if (transformed.sprite !== undefined) {
    transformed.sprite = resolveSpriteField(transformed.sprite, spriteVersion);
  }

  return transformed;
}

/**
 * Transform a single weather entry: convert iconSpriteKey to sprite URL.
 */
function transformWeather(weatherKey, weatherData, spriteVersion) {
  if (!weatherData || typeof weatherData !== "object") {
    return weatherData;
  }

  const transformed = { ...weatherData };

  if ("iconSpriteKey" in transformed) {
    transformed.sprite = resolveSpriteField(transformed.iconSpriteKey, spriteVersion);
    delete transformed.iconSpriteKey;
  }

  return transformed;
}

/**
 * Transform all items in a category.
 * @param {Object} data - Complete data object
 * @param {string} category - Category type (decor, eggs, items, mutations, pets)
 * @param {Object} options
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
      transformed[key] = transformItem(key, value, spriteVersion);
    } catch (error) {
      logger.error(`Error transforming ${category} ${key}:`, error);
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
