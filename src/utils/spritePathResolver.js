// src/utils/spritePathResolver.js

import { buildSpriteUrl } from "./spriteUrlBuilder.js";

/**
 * Mapping des segments de path du bundle vers les catégories de fichiers sur disque.
 * Ex: "sprite/seed/Carrot" → group "seed" → category "seeds"
 */
const GROUP_TO_CATEGORY = {
  seed: "seeds",
  plant: "plants",
  tallplant: "tallPlants",
  pet: "pets",
  decor: "decor",
  item: "items",
  mutation: "mutations",
  "mutation-overlay": "mutations",
  ui: "ui",
  animation: "animations",
  object: "objects",
  winter: "winter",
};

/**
 * Parse un sprite path du bundle en group et name.
 *
 * @param {string} spritePath - Ex: "sprite/seed/Carrot"
 * @returns {{ group: string, name: string } | null}
 */
function parseSpriteKey(spritePath) {
  if (!spritePath || typeof spritePath !== "string") return null;

  const match = spritePath.match(/^sprite\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return { group: match[1], name: match[2] };
}

/**
 * Convertit un sprite path du bundle en URL de serving.
 *
 * @param {string} spritePath - Ex: "sprite/seed/Carrot"
 * @param {object} options
 * @param {string|null} options.version - Version pour cache-busting
 * @returns {string|null}
 */
export function resolveSpritePath(spritePath, options = {}) {
  const parsed = parseSpriteKey(spritePath);
  if (!parsed) return null;

  const category = GROUP_TO_CATEGORY[parsed.group] || parsed.group;
  return buildSpriteUrl(category, parsed.name, options);
}
