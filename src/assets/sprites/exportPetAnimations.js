// src/assets/sprites/exportPetAnimations.js

import { config } from "../../config/index.js";
import { exportRiveAnimations, ANIMATIONS_SIDECAR } from "./riveAnimationExport.js";
import {
  ACTIVE_VARIANTS,
  PET_STATE_MACHINE,
  findContainerArtboard,
} from "./exportPetsFromRive.js";

/**
 * Export des animations de pets depuis `rive/pets.riv`.
 *
 * À l'inverse des PNG (`exportPetsFromRive.js`), qui figent une pose, on sort
 * ici une boucle par timeline utile. Le jeu, lui, ne produit jamais de fichier
 * animé : il rejoue le Rive en direct dans le navigateur. C'est donc un usage
 * propre à l'API — servir un pet qui bouge à un client (Discord, page web,
 * overlay) qui ne va pas embarquer un runtime Rive.
 *
 * La mécanique d'export est commune à tous les fichiers Rive
 * (`riveAnimationExport.js`) ; ce module n'en décrit que la part spécifique aux
 * pets : quels clips, et les deux variantes météo.
 */

// Timelines exportées. Il en existe ~22 par espèce (cf. doc-rive.md §2) ; on
// s'en tient à celles qui décrivent un état durable du pet et qui bouclent
// proprement sur elles-mêmes. Les one-shots (`Pet_Mount`, `Ability_Burst`,
// `Thunder_On`…) n'ont pas de sens en boucle.
//
// 30 fps partout. On avait commencé plus bas (15 pour l'idle) pour tenir le
// poids des fichiers, mais le pas se voit : contrairement à l'intuition, c'est
// sur les mouvements *lents* qu'un échantillonnage bas saccade le plus, parce
// que l'œil suit le mouvement et voit chaque saut. Le rendu ne coûte presque
// rien de plus (~2 s par boucle dans les deux cas) ; c'est le poids du fichier
// qui croît linéairement, ~1,5 Mo pour un idle de 7 s.
const CLIP_FPS = 30;

export const PET_CLIPS = [
  { id: "idle", timeline: "Pet_Idle", fps: CLIP_FPS },
  { id: "walk", timeline: "Pet_Walk", fps: CLIP_FPS },
  { id: "eat", timeline: "Pet_Eat", fps: CLIP_FPS },
  { id: "sleep", timeline: "Pet_Sleep", fps: CLIP_FPS },
];

export const PET_ANIMATIONS_FILE = ANIMATIONS_SIDECAR;
export const ANIMATION_CATEGORY = "pets";

// Secondes d'amorçage quand une entrée booléenne est forcée. Même valeur que
// les images fixes : les VFX météo (flammes, éclairs) mettent ~3 s à s'établir,
// et on veut filmer le régime établi, pas la transition d'allumage.
const SETTLE_SECONDS_WITH_INPUTS = 4;

// Les variantes météo n'ont qu'un idle : leur intérêt est de montrer le pet
// sous météo active, pas de décliner tous ses états.
const VARIANT_CLIPS = ["idle"];

/**
 * Liste des rendus : chaque espèce × chaque clip demandé, plus les variantes.
 */
function buildTargets(file, artboardNames) {
  const containerName = findContainerArtboard(artboardNames);
  const petNames = artboardNames.filter((n) => n !== containerName);

  const wanted = PET_CLIPS.filter((clip) => config.animations.clips.includes(clip.id));
  const targets = [];

  for (const name of petNames) {
    for (const clip of wanted) {
      targets.push({
        artboard: name,
        name,
        clip,
        stateMachineName: PET_STATE_MACHINE,
      });
    }
  }

  for (const variant of ACTIVE_VARIANTS) {
    if (!petNames.includes(variant.artboard)) continue;
    for (const clip of wanted.filter((c) => VARIANT_CLIPS.includes(c.id))) {
      targets.push({
        artboard: variant.artboard,
        name: variant.name,
        clip,
        stateMachineName: PET_STATE_MACHINE,
        bools: { [variant.input]: true },
        settleSeconds: SETTLE_SECONDS_WITH_INPUTS,
      });
    }
  }

  return targets;
}

/**
 * @param {object} options - Voir exportRiveAnimations
 */
export async function exportPetAnimations(options = {}) {
  return exportRiveAnimations({
    ...options,
    category: ANIMATION_CATEGORY,
    riveKey: "pets",
    buildTargets,
  });
}
