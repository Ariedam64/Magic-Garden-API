/**
 * Intelligent sprite name matcher
 * Handles name variations between data keys and sprite filenames
 * Examples: "OrangeTulip" -> "Tulip", "DawnCelestial" -> "DawnCelestial"
 */

import fs from "fs";
import path from "path";

/**
 * Calculate similarity score between two strings using Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1, higher is more similar)
 */
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;

  const len1 = s1.length;
  const len2 = s2.length;

  // Levenshtein distance matrix
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);

  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/**
 * Extract potential base names from a plant key
 * Handles color prefixes, suffixes, and common variations
 * @param {string} plantKey - Plant key from data (e.g., "OrangeTulip")
 * @returns {string[]} Array of potential base names
 */
function extractBaseNames(plantKey) {
  const variations = [plantKey];

  // Common color prefixes to try removing
  const colorPrefixes = [
    "Orange",
    "Red",
    "Blue",
    "Yellow",
    "Green",
    "Purple",
    "Pink",
    "White",
    "Black",
    "Dawn",
    "Moon",
    "Violet",
  ];

  // Try removing color prefixes
  for (const color of colorPrefixes) {
    if (plantKey.startsWith(color)) {
      const withoutColor = plantKey.slice(color.length);
      if (withoutColor.length > 0) {
        variations.push(withoutColor);
      }
    }
  }

  // Common suffixes to try removing/adding
  const suffixes = ["Plant", "Tree", "Bush", "Hedge", "Cutting", "Spore"];

  for (const suffix of suffixes) {
    if (plantKey.endsWith(suffix)) {
      variations.push(plantKey.slice(0, -suffix.length));
    } else {
      variations.push(plantKey + suffix);
    }
  }

  // Try "Celestial" variations (DawnCelestial, MoonCelestial, etc.)
  if (plantKey.includes("Celestial")) {
    variations.push(plantKey.replace("Celestial", ""));
    variations.push(plantKey.replace("Celestial", "CelestialPlant"));
    variations.push(plantKey.replace("Celestial", "CelestialCrop"));
  }

  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Find best matching sprite filename for a plant key
 * @param {string} plantKey - Plant key from data
 * @param {string[]} availableSprites - Array of available sprite filenames (without .png)
 * @param {number} minSimilarity - Minimum similarity threshold (0-1)
 * @returns {string|null} Best matching sprite name or null if no match found
 */
function findBestMatch(plantKey, availableSprites, minSimilarity = 0.6) {
  // First try exact match (case-insensitive)
  const exactMatch = availableSprites.find(
    (sprite) => sprite.toLowerCase() === plantKey.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Try base name variations
  const baseNames = extractBaseNames(plantKey);
  for (const baseName of baseNames) {
    const exactVariationMatch = availableSprites.find(
      (sprite) => sprite.toLowerCase() === baseName.toLowerCase()
    );
    if (exactVariationMatch) return exactVariationMatch;
  }

  // Calculate similarity scores for all sprites
  const scores = availableSprites.map((sprite) => {
    // Check similarity against plant key and all base name variations
    const allNames = [plantKey, ...baseNames];
    const maxScore = Math.max(...allNames.map((name) => calculateSimilarity(name, sprite)));

    return {
      sprite,
      score: maxScore,
    };
  });

  // Sort by score (descending)
  scores.sort((a, b) => b.score - a.score);

  // Return best match if it meets the threshold
  if (scores[0] && scores[0].score >= minSimilarity) {
    return scores[0].sprite;
  }

  return null;
}

/**
 * Load available sprite filenames from a directory
 * @param {string} directory - Path to sprite directory
 * @returns {string[]} Array of sprite filenames (without .png extension)
 */
function loadAvailableSprites(directory) {
  try {
    const files = fs.readdirSync(directory);
    return files
      .filter((file) => file.endsWith(".png"))
      .map((file) => path.basename(file, ".png"));
  } catch (error) {
    console.error(`Error loading sprites from ${directory}:`, error.message);
    return [];
  }
}

/**
 * Cache for available sprites by category
 * @type {Map<string, string[]>}
 */
const spriteCache = new Map();

/**
 * Get available sprites for a category (with caching)
 * @param {string} category - Sprite category (plants, seeds, tallPlants, etc.)
 * @param {string} baseDir - Base sprites directory
 * @returns {string[]} Array of available sprite names
 */
function getAvailableSprites(category, baseDir = "./sprites_dump/sprite") {
  const cacheKey = `${baseDir}/${category}`;

  if (!spriteCache.has(cacheKey)) {
    const dir = path.join(baseDir, category);
    const sprites = loadAvailableSprites(dir);
    spriteCache.set(cacheKey, sprites);
  }

  return spriteCache.get(cacheKey);
}

/**
 * Clear sprite cache (useful for testing or after sprite updates)
 */
function clearCache() {
  spriteCache.clear();
}

/**
 * Match plant key to sprite filename
 * @param {string} plantKey - Plant key from data
 * @param {string} category - Sprite category (plants, seeds, tallPlants)
 * @param {Object} options - Options
 * @param {string} options.baseDir - Base sprites directory
 * @param {number} options.minSimilarity - Minimum similarity threshold
 * @returns {string|null} Matched sprite name or null
 */
function matchSpriteName(plantKey, category, options = {}) {
  const { baseDir = "./sprites_dump/sprite", minSimilarity = 0.6 } = options;

  const availableSprites = getAvailableSprites(category, baseDir);

  if (availableSprites.length === 0) {
    return null;
  }

  return findBestMatch(plantKey, availableSprites, minSimilarity);
}

export {
  matchSpriteName,
  getAvailableSprites,
  clearCache,
  calculateSimilarity,
  extractBaseNames,
  findBestMatch,
};
