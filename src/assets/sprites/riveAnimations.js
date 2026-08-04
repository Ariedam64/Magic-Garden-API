// src/assets/sprites/riveAnimations.js

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { buildAnimationUrl } from "../../utils/spriteUrlBuilder.js";
import { getStoredVersionCached } from "../../core/game/versionStorage.js";
import { ANIMATIONS_SIDECAR } from "./riveAnimationExport.js";

/**
 * Accès en lecture aux animations rendues depuis Rive.
 *
 * Les sidecars écrits par l'export sont la source unique : ils disent quelles
 * boucles existent, dans quels formats, et à quelle taille. Les routes et
 * l'enrichissement de `/data/pets` et `/data/decors` y lisent tous, pour qu'une
 * entrée ne puisse pas apparaître dans le catalogue et manquer dans les données.
 *
 * Les caches sont revalidés sur le mtime des sidecars : l'export tourne dans un
 * processus fils (cf. `services/animationSync.js`), donc l'API ne peut pas
 * compter sur un signal interne pour savoir qu'il a fini.
 */

// Catégories exportées, dans l'ordre où le catalogue les présente.
export const ANIMATION_CATEGORIES = ["pets", "decor"];

const CACHE_TTL_MS = 60_000;

const EMPTY = { riveUrl: null, generatedAt: null, animations: {} };

const caches = new Map();

function cacheFor(category) {
  if (!caches.has(category)) {
    caches.set(category, { checkedAt: 0, mtimeMs: 0, data: null });
  }
  return caches.get(category);
}

function sidecarPath(category) {
  return path.join(config.sprites.exportDir, "animation", category, ANIMATIONS_SIDECAR);
}

/**
 * Répertoire disque d'une catégorie d'animations.
 */
export function animationDir(category) {
  return path.join(config.sprites.exportDir, "animation", category);
}

/**
 * Charge le sidecar d'une catégorie (revalidé sur mtime, au plus une fois par
 * minute).
 *
 * @param {string} category
 * @returns {Promise<{ riveUrl: string|null, generatedAt: string|null, animations: object }>}
 */
export async function getAnimations(category) {
  const cache = cacheFor(category);

  const now = Date.now();
  if (cache.data && now - cache.checkedAt < CACHE_TTL_MS) return cache.data;

  const file = sidecarPath(category);
  cache.checkedAt = now;

  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    // Pas encore généré : on répond un catalogue vide plutôt que d'échouer,
    // les endpoints restent utilisables sans animations.
    cache.mtimeMs = 0;
    cache.data = EMPTY;
    return cache.data;
  }

  if (cache.data && mtimeMs === cache.mtimeMs) return cache.data;

  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    cache.mtimeMs = mtimeMs;
    cache.data = {
      riveUrl: parsed?.riveUrl ?? null,
      generatedAt: parsed?.generatedAt ?? null,
      animations: parsed?.animations ?? {},
    };
  } catch {
    // Sidecar en cours d'écriture ou corrompu : on garde ce qu'on avait.
    cache.data ??= EMPTY;
  }

  return cache.data;
}

/**
 * Raccourci pour la catégorie des pets.
 */
export async function getPetAnimations() {
  return getAnimations("pets");
}

export function clearAnimationsCache() {
  caches.clear();
}

// Nom historique, conservé pour les appelants existants.
export const clearPetAnimationsCache = clearAnimationsCache;

/**
 * Construit le bloc `animations` d'une entrée de données.
 *
 * @param {string} category - pets | decor
 * @param {string} id - Nom de l'artboard rendu
 * @param {object} options
 * @param {object} options.animations - Table issue de getAnimations()
 * @param {string|null} options.version - Version de jeu (cache-busting)
 * @returns {object|null} clips indexés par id, ou null s'il n'y en a pas
 */
export function buildAnimationLinks(category, id, { animations, version = null } = {}) {
  const clips = animations?.[id];
  if (!clips || !Object.keys(clips).length) return null;

  const out = {};

  for (const [clipId, meta] of Object.entries(clips)) {
    const [primary, ...alternates] = Object.keys(meta?.formats ?? {});
    if (!primary) continue;

    // `url` est le lien, dans le format principal (WebP par défaut). Les
    // autres formats n'apparaissent que s'il y en a : répéter la même URL
    // sous une clé `webp` ne dirait rien de plus.
    const urls = {};
    for (const format of alternates) {
      urls[format] = buildAnimationUrl(category, id, clipId, format, { version });
    }

    out[clipId] = {
      url: buildAnimationUrl(category, id, clipId, primary, { version }),
      format: primary,
      ...urls,
      // Timeline d'origine : c'est ce qu'un client qui rejoue le .riv en direct
      // doit demander pour obtenir cette animation-là (cf. le bloc `rive`).
      timeline: meta.timeline ?? null,
      width: meta.width,
      height: meta.height,
      frames: meta.frames,
      fps: meta.fps,
      durationMs: meta.durationMs,
      anchor: meta.anchor ?? null,
    };
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Entrées à plat pour le catalogue `/assets/animations`.
 *
 * @param {string[]} categories
 */
export async function getAnimationEntries(categories = ANIMATION_CATEGORIES) {
  const version = await getStoredVersionCached().catch(() => null);
  const entries = [];

  for (const category of categories) {
    const { animations } = await getAnimations(category);

    for (const [name, clips] of Object.entries(animations)) {
      for (const [clipId, meta] of Object.entries(clips)) {
        const [primary, ...alternates] = Object.keys(meta?.formats ?? {});
        if (!primary) continue;

        const urls = {};
        for (const format of alternates) {
          urls[format] = buildAnimationUrl(category, name, clipId, format, { version });
        }

        entries.push({
          category,
          name,
          clip: clipId,
          timeline: meta.timeline ?? null,
          url: buildAnimationUrl(category, name, clipId, primary, { version }),
          format: primary,
          ...urls,
          width: meta.width,
          height: meta.height,
          frames: meta.frames,
          fps: meta.fps,
          durationMs: meta.durationMs,
          anchor: meta.anchor ?? null,
          bytes: meta.formats,
        });
      }
    }
  }

  return entries.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name) ||
      a.clip.localeCompare(b.clip)
  );
}

/**
 * Source (fichier .riv, date de génération) de chaque catégorie.
 */
export async function getAnimationSources(categories = ANIMATION_CATEGORIES) {
  const sources = {};

  for (const category of categories) {
    const { riveUrl, generatedAt } = await getAnimations(category);
    sources[category] = { riveUrl, generatedAt };
  }

  return sources;
}
