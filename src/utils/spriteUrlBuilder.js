/**
 * Sprite URL builder utility
 * Builds URLs for sprites based on category and name
 */

import { config } from "../config/index.js";

/**
 * Build sprite URL for a given category and sprite name
 * @param {string} category - Sprite category (plants, seeds, tallPlants, etc.)
 * @param {string} spriteName - Sprite filename (without .png)
 * @param {Object} options - Options
 * @param {string} options.baseUrl - Base URL for sprites (defaults to config)
 * @param {boolean} options.absolute - Whether to return absolute URL (default: true)
 * @returns {string} Sprite URL
 */
function buildSpriteUrl(category, spriteName, options = {}) {
  const { baseUrl = config.sprites.baseUrl, absolute = true } = options;

  if (!spriteName) {
    return null;
  }

  const relativePath = `/sprites/${category}/${spriteName}.png`;

  if (absolute && baseUrl) {
    // Remove trailing slash from baseUrl if present
    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    return `${cleanBaseUrl}${relativePath}`;
  }

  return relativePath;
}

/**
 * Build multiple sprite URLs at once
 * @param {Array<{category: string, spriteName: string}>} sprites - Array of sprite info
 * @param {Object} options - Options (same as buildSpriteUrl)
 * @returns {string[]} Array of sprite URLs
 */
function buildSpriteUrls(sprites, options = {}) {
  return sprites.map(({ category, spriteName }) => buildSpriteUrl(category, spriteName, options));
}

/**
 * Build sprite URL object with multiple formats
 * @param {string} category - Sprite category
 * @param {string} spriteName - Sprite filename
 * @returns {Object} Object with different URL formats
 */
function buildSpriteUrlObject(category, spriteName) {
  if (!spriteName) {
    return {
      absolute: null,
      relative: null,
      category: null,
      name: null,
    };
  }

  return {
    absolute: buildSpriteUrl(category, spriteName, { absolute: true }),
    relative: buildSpriteUrl(category, spriteName, { absolute: false }),
    category,
    name: spriteName,
  };
}

export {
  buildSpriteUrl,
  buildSpriteUrls,
  buildSpriteUrlObject,
};
