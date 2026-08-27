/**
 * Generic data transformer with sprite URLs.
 * Converts sprite paths from the bundle (e.g. "sprite/seed/Carrot")
 * into serving URLs (e.g. "/assets/sprites/seeds/Carrot.png").
 */

import { resolveSpritePath, resolveSpritePathsDeep } from "../utils/spritePathResolver.js";
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
 * Sprite d'un décor, déduit de son champ `art`.
 *
 * Les décors sont la seule catégorie sans champ `sprite` : leur image est dans
 * `art`, sous deux formes. Un path d'atlas pour la cinquantaine de décors
 * fixes, et un `{ artboardName }` pour les huit qui sont des artboards Rive
 * animés. Ces huit-là ont malgré tout un PNG d'atlas, mais rangé sous le nom de
 * l'artboard et non sous l'identifiant de données — `StoneBirdBath` contre
 * `StoneBirdbath` — d'où le passage par `artboardName` plutôt que par la clé.
 */
function spriteFromDecorArt(art, spriteVersion) {
  if (typeof art === "string") {
    return resolveSpritePath(art, { version: spriteVersion });
  }

  if (art && typeof art === "object" && typeof art.artboardName === "string") {
    return resolveSpritePath(`sprite/decor/${art.artboardName}`, {
      version: spriteVersion,
    });
  }

  return null;
}

/**
 * Transform a single data item: convert sprite paths to URLs.
 */
function transformItem(itemKey, itemData, spriteVersion, category) {
  if (!itemData || typeof itemData !== "object") {
    return itemData;
  }

  const transformed = resolveSpritePathsDeep(itemData, { version: spriteVersion });

  if (transformed.sprite !== undefined) {
    transformed.sprite = resolveSpriteField(transformed.sprite, spriteVersion);
  }

  // Fallback for mutations without an explicit sprite: use ui/Mutation{Key}.
  if (
    category === "mutations" &&
    (transformed.sprite == null || transformed.sprite === undefined) &&
    typeof itemKey === "string"
  ) {
    transformed.sprite = resolveSpritePath(`sprite/ui/Mutation${itemKey}`, {
      version: spriteVersion,
    });
  }

  // Les décors n'ont pas de `sprite` à eux : on le dérive de `art`, qui garde
  // son path brut. `sprite` en tête, comme dans les autres catégories.
  if (category === "decor" && transformed.sprite == null) {
    const fromArt = spriteFromDecorArt(itemData.art, spriteVersion);
    if (fromArt) {
      const { sprite: _absent, ...rest } = transformed;
      return { sprite: fromArt, ...rest };
    }
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

  const transformed = resolveSpritePathsDeep(weatherData, { version: spriteVersion });

  if ("iconSpriteKey" in transformed) {
    transformed.sprite = resolveSpriteField(weatherData.iconSpriteKey, spriteVersion);
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
      transformed[key] = transformItem(key, value, spriteVersion, category);
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
