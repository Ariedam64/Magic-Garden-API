// src/assets/sprites/exportDecorAnimations.js

import { logger } from "../../logger/index.js";
import { exportRiveAnimations } from "./riveAnimationExport.js";

/**
 * Export des animations de décors depuis `rive/decor.riv`.
 *
 * Bien plus simples que les pets : chaque décor est un artboard qui n'expose
 * qu'**une seule timeline** et une state machine **sans aucune entrée** — pas
 * d'états, pas de variantes, rien à piloter. Le moulin tourne, la fontaine
 * coule, le chaudron bout.
 *
 * Deux conséquences sur la façon de les traiter :
 *
 * 1. **On ne peut pas coder les noms de timelines en dur.** Ils sont
 *    incohérents d'un décor à l'autre (`WoodWindmill_On`, `WindSpinner_Spins`,
 *    `Caludron` — la faute de frappe est dans le fichier du jeu — et deux
 *    `Timeline 1`). On prend donc ce que l'artboard déclare.
 * 2. **Le nom de la state machine non plus.** Elles s'appellent toutes
 *    `State Machine 1` aujourd'hui, mais rien ne le garantit : on lit celle que
 *    l'artboard porte, et on s'en passe s'il n'en a pas.
 */

export const ANIMATION_CATEGORY = "decor";

// Un décor tourne en continu, souvent vite (une hélice, un jet d'eau) : on
// garde la même cadence que les pets, où elle est déjà confortable.
const CLIP_FPS = 30;

// Identifiant de clip quand l'artboard n'a qu'une timeline — le cas de tous les
// décors. Plus lisible qu'un slug tiré d'un nom interne : `MarbleFountain_loop`
// plutôt que `MarbleFountain_marblefountain_on`.
const SINGLE_CLIP_ID = "loop";

function slugify(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTargets(file, artboardNames) {
  const containerName = file.defaultArtboard?.()?.name ?? null;
  const targets = [];

  for (const name of artboardNames) {
    // Contrairement aux pets, le conteneur par défaut de `decor.riv` est un
    // décor comme un autre — on ne saute que s'il duplique un artboard nommé.
    const artboard = file.artboardByName(name);
    if (!artboard) continue;

    const animations = [];
    for (let i = 0; i < artboard.animationCount(); i++) {
      animations.push(artboard.animationByIndex(i).name);
    }

    if (!animations.length) {
      logger.debug({ artboard: name }, "Decor artboard has no timeline, skipping");
      continue;
    }

    const stateMachineName =
      artboard.stateMachineCount() > 0 ? artboard.stateMachineByIndex(0).name : null;

    for (const timeline of animations) {
      targets.push({
        artboard: name,
        name,
        stateMachineName,
        clip: {
          id: animations.length === 1 ? SINGLE_CLIP_ID : slugify(timeline),
          timeline,
          fps: CLIP_FPS,
        },
      });
    }
  }

  logger.debug({ container: containerName, targets: targets.length }, "Decor animation targets");
  return targets;
}

/**
 * @param {object} options - Voir exportRiveAnimations
 */
export async function exportDecorAnimations(options = {}) {
  return exportRiveAnimations({
    ...options,
    category: ANIMATION_CATEGORY,
    riveKey: "decor",
    buildTargets,
  });
}
