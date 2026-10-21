// src/assets/sprites/riveManifest.js

import { getBaseUrl } from "../assets.js";
import { loadManifest, assetSourcePaths } from "../manifest.js";
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
 * State machine des artboards de pets, telle que le jeu l'instancie
 * (`createSprite({ ..., stateMachineName: "Pet State Machine" })`).
 *
 * Elle vit ici, avec les autres conventions des fichiers Rive, plutôt que dans
 * l'export des PNG : l'API la publie (riveSource.js) sans avoir à charger le
 * moteur de rendu.
 */
export const PET_STATE_MACHINE = "Pet State Machine";

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
      // Depuis v1231 les sources sont des `{ src, progressSize }` : filtrer
      // sur `typeof s === "string"` vidait la liste, et plus aucun Rive
      // n'était synchronisé (ni les pets d'Halloween, ni les mises à jour).
      const src = assetSourcePaths(asset).find((s) => s.endsWith(".riv"));
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

/**
 * Les pets ne tiennent plus dans un seul fichier.
 *
 * Les pets d'événement arrivent dans leur propre `.riv` : Moth, Snake et Toad
 * (Halloween, 1598) sont dans `halloween-pets.riv`, pas dans `pets.riv`. Le
 * jeu associe chaque espèce à son fichier, nous n'avons que le nom de celui-ci :
 * `pets`, ou `<événement>-pets`. Les silhouettes (`*-pets-silhouettes`) sont
 * des JSON, pas des `.riv`, et ne passent donc jamais par ici.
 */
export function isPetsRiveKey(key) {
  return key === "pets" || /-pets$/.test(String(key ?? ""));
}

/**
 * Fichiers Rive de pets, `pets.riv` en tête : en cas d'artboard homonyme dans
 * deux fichiers, c'est le fichier principal qui fait foi.
 *
 * @returns {Promise<Array<{ key: string, url: string }>>}
 */
export async function resolvePetsRiveFiles({ baseUrl = null } = {}) {
  const assets = await resolveRiveAssets({ baseUrl });
  return assets
    .filter((asset) => isPetsRiveKey(asset.key))
    .sort((a, b) => (a.key === "pets" ? -1 : b.key === "pets" ? 1 : a.key.localeCompare(b.key)))
    .map(({ key, url }) => ({ key, url }));
}

/**
 * Repère l'artboard conteneur d'un fichier, celui que le jeu ne rend jamais.
 *
 * **Ne pas se fier à `defaultArtboard()` du runtime.** C'est ce qu'on faisait :
 * il désignait `Pets` dans `pets.riv`, et la v830 lui a fait désigner `Bat`.
 * Résultat, une espèce disparaissait de l'export et le conteneur sortait à sa
 * place. Structurellement il est indiscernable d'un pet — mêmes dimensions,
 * mêmes timelines, même state machine.
 *
 * Le seul repère fiable est son nom : celui du fichier (`pets.riv` -> `Pets`).
 * Les autres fichiers n'en ont pas — dans `decor.riv`, aucun artboard ne
 * s'appelle `Decor`, et rien n'est donc exclu.
 *
 * En cas de doute on n'exclut rien : montrer un artboard en trop se voit,
 * en perdre un ne se voit pas.
 *
 * @param {string[]} artboardNames
 * @param {string} key - Clé du fichier (`pets`, `decor`…)
 * @returns {string|null}
 */
export function findContainerArtboard(artboardNames, key) {
  const wanted = String(key ?? "").toLowerCase();
  if (!wanted) return null;
  return artboardNames.find((name) => name.toLowerCase() === wanted) ?? null;
}
