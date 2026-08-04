// src/assets/sprites/riveManifest.js

import { getBaseUrl } from "../assets.js";
import { loadManifest } from "../manifest.js";
import { joinUrl } from "../../utils/url.js";

/**
 * Résolution de **tous** les fichiers Rive du manifest.
 *
 * Le jeu ne les range pas au même endroit : `pets.riv` et `avatar.riv` sont
 * dans le bundle `default`, mais `decor.riv`, `currency.riv`, `giftbox.riv` et
 * `thought-bubble.riv` ont chacun **leur propre bundle**, nommé d'après le
 * fichier. Chercher dans le seul bundle `default` — ce que faisait la
 * résolution d'origine, écrite quand seuls les pets comptaient — en rate donc
 * les deux tiers.
 *
 * On balaie tous les bundles, ce qui a un second effet utile : le jour où le
 * jeu déplace `pets.riv` ailleurs, on continue de le trouver.
 */

/**
 * Clé stable d'un fichier Rive, déduite de son nom de fichier.
 *
 * Les URL sont versionnées par hash (`/runtime-assets/pets.<hash>.riv`) : on
 * garde le segment qui précède le hash. C'est plus robuste que l'alias, qui
 * peut être renommé côté jeu.
 */
function keyFromSrc(src) {
  const file = src.split("/").pop() || "";
  const [name] = file.split(".");
  return name || null;
}

/**
 * Liste les fichiers Rive déclarés par le manifest.
 *
 * @param {object} options
 * @param {string|null} options.baseUrl
 * @returns {Promise<Array<{ key: string, aliases: string[], bundle: string, src: string, url: string }>>}
 */
export async function resolveRiveAssets({ baseUrl = null } = {}) {
  const resolvedBase = baseUrl || (await getBaseUrl());
  if (!resolvedBase) return [];

  const manifest = await loadManifest({ baseUrl: resolvedBase });
  const bundles = Array.isArray(manifest?.bundles) ? manifest.bundles : [];

  const found = new Map();

  for (const bundle of bundles) {
    for (const asset of bundle?.assets ?? []) {
      const src = (Array.isArray(asset?.src) ? asset.src : []).find(
        (s) => typeof s === "string" && s.endsWith(".riv")
      );
      if (!src) continue;

      const key = keyFromSrc(src);
      // Un même fichier peut être déclaré par plusieurs bundles : on garde la
      // première occurrence, elles pointent la même URL versionnée.
      if (!key || found.has(key)) continue;

      found.set(key, {
        key,
        aliases: Array.isArray(asset?.alias) ? asset.alias : [],
        bundle: bundle?.name ?? null,
        src,
        url: joinUrl(resolvedBase, src),
      });
    }
  }

  return Array.from(found.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * URL d'un fichier Rive donné, ou null s'il a disparu du manifest.
 *
 * @param {string} key - ex: "pets", "decor"
 */
export async function resolveRiveUrl(key, { baseUrl = null } = {}) {
  const assets = await resolveRiveAssets({ baseUrl });
  return assets.find((asset) => asset.key === key)?.url ?? null;
}
