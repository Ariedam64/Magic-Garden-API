// src/assets/sprites/riveFrames.js

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { buildSpriteUrl } from "../../utils/spriteUrlBuilder.js";
import { getStoredVersionCached } from "../../core/game/versionStorage.js";


/**
 * Accès aux sprites qui ne viennent plus d'un atlas TexturePacker.
 *
 * Depuis que le jeu rend ses pets depuis `rive/pets.riv`, `sprite/pet/*` ne
 * contient plus que les œufs côté atlas. Les créatures sont pré-rendues sur
 * disque par exportPetsFromRive.js, avec un sidecar qui porte les mêmes
 * métadonnées qu'une frame d'atlas (taille, ancre). Ce module est la source
 * unique pour ces entrées : la composition de mutations et le catalogue de
 * sprites y lisent tous les deux, sinon les pets disparaissent d'un endpoint
 * sur deux selon qu'il interroge l'atlas ou le disque.
 */

// Nom du sidecar écrit à côté des PNG rendus depuis Rive (préfixé `_` : le
// routeur de sprites n'accepte que des noms en `.png`, il n'est jamais servi).
export const RIVE_FRAMES_FILE = "_rive-frames.json";

// Catégories dont une partie des sprites vient de Rive et non d'un atlas.
// `pets` : toutes les créatures (le jeu les a sorties des atlas).
// `decor` : uniquement les décors que les atlas ne fournissent pas encore.
const RIVE_CATEGORIES = { pets: RIVE_FRAMES_FILE, decor: RIVE_FRAMES_FILE };

// Revalidation sur le mtime des sidecars, au plus une fois par minute. Un
// simple cache à vie ne suffit pas : l'export réécrit ces fichiers quand le jeu
// se met à jour, et le processus, lui, ne redémarre pas toujours — une espèce
// ajoutée par une maj resterait alors invisible jusqu'au prochain démarrage.
const CACHE_TTL_MS = 60_000;

let framesCache = null;
let checkedAt = 0;
let signature = "";

async function sidecarSignature() {
  const stamps = [];

  for (const [category, metadataFile] of Object.entries(RIVE_CATEGORIES)) {
    const file = path.join(config.sprites.exportDir, "sprite", category, metadataFile);
    try {
      stamps.push(`${category}:${(await fs.stat(file)).mtimeMs}`);
    } catch {
      stamps.push(`${category}:-`);
    }
  }

  return stamps.join("|");
}

/**
 * Charge (et met en cache) le contenu des sidecars Rive.
 *
 * @returns {Promise<Record<string, object>>} clé atlas -> métadonnées de frame
 */
export async function getRiveFrames() {
  const now = Date.now();
  if (framesCache && now - checkedAt < CACHE_TTL_MS) return framesCache;

  checkedAt = now;
  const current = await sidecarSignature();
  if (framesCache && current === signature) return framesCache;

  const frames = {};

  for (const [category, metadataFile] of Object.entries(RIVE_CATEGORIES)) {
    const file = path.join(config.sprites.exportDir, "sprite", category, metadataFile);

    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
      for (const [key, meta] of Object.entries(parsed?.frames ?? {})) {
        frames[key] = { ...meta, cat: category };
      }
    } catch {
      // Pas encore exporté (ou plus de sprite Rive dans cette catégorie).
    }
  }

  signature = current;
  framesCache = frames;
  return framesCache;
}

export function clearRiveFramesCache() {
  framesCache = null;
  checkedAt = 0;
  signature = "";
}

/**
 * Retourne le chemin disque du PNG d'une frame Rive.
 */
export function riveSpritePath(meta) {
  return path.join(config.sprites.exportDir, "sprite", meta.cat, `${meta.name}.png`);
}

/**
 * Construit des entrées au format du catalogue de sprites (cf. sprites.js).
 *
 * `frame` couvre tout le PNG et `url` pointe vers notre propre endpoint de
 * serving : contrairement aux frames d'atlas, il n'y a rien à découper.
 */
export async function getRiveSpriteEntries() {
  const frames = await getRiveFrames();
  const version = await getStoredVersionCached();

  return Object.entries(frames).map(([key, meta]) => {
    const { w = 0, h = 0 } = meta.sourceSize ?? {};

    return {
      type: "frame",
      source: "rive",
      cat: meta.cat,
      id: key,
      name: meta.name,

      key,
      sourceJson: null,
      atlasImageSrc: null,
      url: buildSpriteUrl(meta.cat, meta.name, { version }),

      frame: { x: 0, y: 0, w, h },
      rotated: false,
      trimmed: false,
      anchor: meta.anchor ?? null,

      sourceSize: { w, h },
      spriteSourceSize: { x: 0, y: 0, w, h },
    };
  });
}
