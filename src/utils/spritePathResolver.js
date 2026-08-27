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

/**
 * Champs dont la valeur reste le path brut du bundle.
 *
 * `art` est le champ d'origine des décors, publié tel quel depuis toujours ;
 * on lui adjoint un `sprite` résolu plutôt que d'écraser ce que lisent déjà
 * les clients.
 */
const RAW_PATH_FIELDS = new Set(["art"]);

/**
 * Résout, à n'importe quelle profondeur, les sprite paths du bundle en URL.
 *
 * Le jeu ne nomme pas ses champs de la même façon d'une catégorie à l'autre —
 * `sprite` pour les plantes, `art` pour les décors, `activationSprite` au fond
 * des `baseParameters` d'une capacité — et il en ajoute à chaque mise à jour.
 * Tenir la liste des champs connus revenait à perdre en silence tout sprite
 * rangé ailleurs : c'est ce qui est arrivé aux décors, aux variantes de
 * rotation et aux tuiles d'activation. On reconnaît donc la valeur et non le
 * champ — toute chaîne préfixée `sprite/` est un path d'atlas, où qu'elle soit.
 *
 * Un path que le resolver ne sait pas parser est laissé intact : mieux vaut
 * republier la donnée brute du jeu que la remplacer par `null`.
 *
 * @param {*} value - Valeur à parcourir (objet, tableau, primitive)
 * @param {object} options
 * @param {string|null} options.version - Version pour cache-busting
 * @returns {*} Copie de `value` avec les paths résolus
 */
export function resolveSpritePathsDeep(value, options = {}) {
  if (typeof value === "string") {
    if (!value.startsWith("sprite/")) return value;
    return resolveSpritePath(value, options) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveSpritePathsDeep(entry, options));
  }

  if (value && typeof value === "object") {
    // Seuls les objets simples se recopient champ par champ. Les données du jeu
    // contiennent aussi des `Date` (`expiryDate` des graines saisonnières) :
    // les recopier ainsi les réduirait à `{}` et ferait disparaître la date.
    //
    // Le test passe par `toString` et non par le prototype ou `instanceof` :
    // ces données sortent du `vm` de l'extracteur, donc d'un autre realm, où
    // aucune des deux comparaisons ne reconnaîtrait un objet simple.
    if (Object.prototype.toString.call(value) !== "[object Object]") return value;

    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = RAW_PATH_FIELDS.has(key) ? entry : resolveSpritePathsDeep(entry, options);
    }
    return out;
  }

  return value;
}
