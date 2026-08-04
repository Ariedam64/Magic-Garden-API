// src/assets/sprites/riveAnimations.js

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { buildAnimationUrl } from "../../utils/spriteUrlBuilder.js";
import { getStoredVersionCached } from "../../core/game/versionStorage.js";
import { PET_ANIMATIONS_FILE, ANIMATION_CATEGORY } from "./exportPetAnimations.js";

/**
 * Accès en lecture aux animations rendues depuis Rive.
 *
 * Le sidecar écrit par `exportPetAnimations.js` est la source unique : il dit
 * quelles boucles existent, dans quels formats, et à quelle taille. Les routes
 * et l'enrichissement de `/data/pets` lisent tous les deux ici, pour qu'un pet
 * ne puisse pas apparaître dans le catalogue et manquer dans les données.
 *
 * Le cache est revalidé sur le mtime du sidecar : l'export tourne dans un
 * processus fils (cf. `services/animationSync.js`), donc l'API ne peut pas
 * compter sur un signal interne pour savoir qu'il a fini.
 */

const CACHE_TTL_MS = 60_000;

const cache = {
  checkedAt: 0,
  mtimeMs: 0,
  data: null,
};

function sidecarPath(category = ANIMATION_CATEGORY) {
  return path.join(config.sprites.exportDir, "animation", category, PET_ANIMATIONS_FILE);
}

/**
 * Répertoire disque d'une catégorie d'animations.
 */
export function animationDir(category = ANIMATION_CATEGORY) {
  return path.join(config.sprites.exportDir, "animation", category);
}

/**
 * Charge le sidecar des animations (revalidé sur mtime, au plus une fois par
 * minute).
 *
 * @returns {Promise<{ riveUrl: string|null, generatedAt: string|null, animations: object }>}
 */
export async function getPetAnimations() {
  const now = Date.now();
  if (cache.data && now - cache.checkedAt < CACHE_TTL_MS) return cache.data;

  const file = sidecarPath();
  cache.checkedAt = now;

  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    // Pas encore généré : on répond un catalogue vide plutôt que d'échouer,
    // les endpoints restent utilisables sans animations.
    cache.mtimeMs = 0;
    cache.data = { riveUrl: null, generatedAt: null, animations: {} };
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
    cache.data ??= { riveUrl: null, generatedAt: null, animations: {} };
  }

  return cache.data;
}

export function clearPetAnimationsCache() {
  cache.checkedAt = 0;
  cache.mtimeMs = 0;
  cache.data = null;
}

/**
 * Construit le bloc `animations` d'une entrée de `/data/pets`.
 *
 * @param {string} petId
 * @param {object} options
 * @param {object} options.animations - Table issue de getPetAnimations()
 * @param {string|null} options.version - Version de jeu (cache-busting)
 * @returns {object|null} clips indexés par id, ou null si l'espèce n'en a pas
 */
export function buildPetAnimationLinks(petId, { animations, version = null } = {}) {
  const clips = animations?.[petId];
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
      urls[format] = buildAnimationUrl(ANIMATION_CATEGORY, petId, clipId, format, { version });
    }

    out[clipId] = {
      url: buildAnimationUrl(ANIMATION_CATEGORY, petId, clipId, primary, { version }),
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
 */
export async function getAnimationEntries() {
  const { animations } = await getPetAnimations();
  const version = await getStoredVersionCached().catch(() => null);

  const entries = [];

  for (const [name, clips] of Object.entries(animations)) {
    for (const [clipId, meta] of Object.entries(clips)) {
      const [primary, ...alternates] = Object.keys(meta?.formats ?? {});
      if (!primary) continue;

      const urls = {};
      for (const format of alternates) {
        urls[format] = buildAnimationUrl(ANIMATION_CATEGORY, name, clipId, format, { version });
      }

      entries.push({
        category: ANIMATION_CATEGORY,
        name,
        clip: clipId,
        timeline: meta.timeline ?? null,
        url: buildAnimationUrl(ANIMATION_CATEGORY, name, clipId, primary, { version }),
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

  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.clip.localeCompare(b.clip));
}
