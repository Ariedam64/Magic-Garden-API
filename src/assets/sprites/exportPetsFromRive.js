// src/assets/sprites/exportPetsFromRive.js

import fs from "node:fs/promises";
import path from "node:path";
import { resolveRiveUrl } from "./riveManifest.js";
import { logger } from "../../logger/index.js";
import { loadRiveFile, renderArtboardToPng } from "./riveRenderer.js";
import { RIVE_FRAMES_FILE } from "./riveFrames.js";

/**
 * Export des sprites de pets depuis le fichier Rive du jeu.
 *
 * Le jeu a sorti les pets des atlas TexturePacker : `sprite/pet/*` ne contient
 * plus que les œufs, et chaque créature est un artboard vectoriel de
 * `rive/pets.riv` rendu à la volée côté client :
 *
 *   createSprite({ riveFileSrc: te.pets, artboardName: <PetId>,
 *                  stateMachineName: `Pet State Machine`, ... })
 *
 * On reproduit ce rendu ici pour régénérer les PNG dans `sprite/pets/`, à côté
 * des œufs qui, eux, restent dans l'atlas.
 */

// Clé du fichier Rive des pets dans le manifest (le `src` réel est versionné
// par hash, ex: /runtime-assets/pets.<hash>.riv).
const PETS_RIVE_KEY = "pets";

export const PET_STATE_MACHINE = "Pet State Machine";

export { RIVE_FRAMES_FILE as PET_METADATA_FILE } from "./riveFrames.js";

// Variantes "météo active" : le jeu ne change pas d'artboard, il pousse un
// input booléen sur la state machine (map `kl` du bundle). Les anciens atlas
// exposaient ces poses comme des sprites distincts — on garde ces noms.
//
// Le jeu ne bake jamais ces variantes en image fixe : il n'existe donc aucune
// pose de référence, et sa pose d'entrée attrape les éclairs/flammes à un creux
// de leur pulsation. C'est le seul cas où on s'écarte de sa recette.
export const ACTIVE_VARIANTS = [
  { artboard: "FireHorse", name: "FireHorseActive", input: "fire" },
  { artboard: "ThunderWolf", name: "ThunderWolfActive", input: "thunder" },
];

// Secondes d'amorçage quand un input est forcé, comme le jeu (`settleSeconds`
// vaut 4 dès qu'il pousse sleep/fire/thunder, et rien sinon).
const SETTLE_SECONDS_WITH_INPUTS = 4;

/**
 * Résout l'URL du .riv des pets depuis le manifest.
 *
 * @returns {Promise<string|null>}
 */
export async function resolvePetsRiveUrl(baseUrl = null) {
  return resolveRiveUrl(PETS_RIVE_KEY, { baseUrl });
}

/**
 * Repère l'artboard conteneur du fichier, celui que le jeu ne rend jamais.
 *
 * **Ne pas se fier à `defaultArtboard()`.** C'est ce qu'on faisait, et la v830
 * l'a cassé : il renvoyait `Pets`, il renvoie désormais `Bat`. Résultat, la
 * chauve-souris n'était plus exportée et le conteneur sortait à sa place, sous
 * le nom `Pets` — une espèce perdue en silence, remplacée par un doublon.
 *
 * Le conteneur porte le nom du fichier (`pets.riv` -> `Pets`). Structurellement
 * il est indiscernable d'un pet : mêmes dimensions, mêmes 22 timelines, même
 * state machine. Ce nom est donc le seul repère fiable.
 *
 * En cas de doute on n'exclut rien : exporter un artboard en trop se voit,
 * perdre une espèce ne se voit pas.
 */
export function findContainerArtboard(artboardNames, key = PETS_RIVE_KEY) {
  const wanted = key.toLowerCase();
  return artboardNames.find((name) => name.toLowerCase() === wanted) ?? null;
}

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Rend tous les artboards de pets en PNG dans `outDir/sprite/pets/`.
 *
 * @param {object} options
 * @param {string} options.outDir - Racine d'export (celle des sprites d'atlas)
 * @param {string|null} options.riveUrl - URL du .riv (résolue si absente)
 * @returns {Promise<{ exported: number, names: string[], riveUrl: string|null, skipped: string|null }>}
 */
export async function exportPetsFromRive({ outDir = "./export", riveUrl = null } = {}) {
  const url = riveUrl || (await resolvePetsRiveUrl());
  if (!url) {
    logger.warn("Pets Rive file not found in manifest, skipping pet sprite export");
    return { exported: 0, names: [], riveUrl: null, skipped: null };
  }

  const bytes = await downloadBuffer(url);
  const { file, artboardNames } = await loadRiveFile(bytes);

  const containerName = findContainerArtboard(artboardNames);
  const petNames = artboardNames.filter((n) => n !== containerName);

  const outputs = [
    // Pose neutre : le baker du jeu capture la frame 0 de `Pet_Idle`, qui
    // tombe sur un extrême du balancement. On prend la pose médiane du cycle,
    // celle des anciens sprites d'atlas. Aucun réglage par espèce, donc un pet
    // ajouté par une maj est traité correctement tout seul.
    ...petNames.map((name) => ({
      artboard: name,
      name,
      inputs: null,
      pose: "neutral",
      settleSeconds: 0,
    })),
    ...ACTIVE_VARIANTS.filter((v) => petNames.includes(v.artboard)).map((v) => ({
      artboard: v.artboard,
      name: v.name,
      inputs: { [v.input]: true },
      pose: "widest",
      settleSeconds: SETTLE_SECONDS_WITH_INPUTS,
    })),
  ];

  const destDir = path.join(outDir, "sprite", "pets");
  await fs.mkdir(destDir, { recursive: true });

  const exportedNames = [];
  const metadata = {};

  for (const target of outputs) {
    try {
      const rendered = await renderArtboardToPng(file, target.artboard, {
        stateMachineName: PET_STATE_MACHINE,
        inputs: target.inputs,
        pose: target.pose,
        settleSeconds: target.settleSeconds,
      });

      if (!rendered) {
        logger.warn({ artboard: target.artboard }, "Pet artboard render returned nothing");
        continue;
      }

      await fs.writeFile(path.join(destDir, `${target.name}.png`), rendered.buffer);

      metadata[`sprite/pet/${target.name}`] = {
        name: target.name,
        artboard: target.artboard,
        sourceSize: { w: rendered.width, h: rendered.height },
        anchor: rendered.anchor,
      };
      exportedNames.push(target.name);
    } catch (err) {
      logger.error(
        { artboard: target.artboard, name: target.name, error: err?.message || String(err) },
        "Failed to render pet sprite from Rive"
      );
    }
  }

  // Sidecar de métadonnées : ces sprites n'étant plus dans un atlas, c'est la
  // seule source de taille/ancre pour la composition de mutations
  // (`/assets/sprites/composed`).
  if (exportedNames.length) {
    await fs.writeFile(
      path.join(destDir, RIVE_FRAMES_FILE),
      JSON.stringify({ riveUrl: url, frames: metadata }, null, 2)
    );
  }

  logger.info(
    { riveUrl: url, exported: exportedNames.length, container: containerName },
    "Pet sprites rendered from Rive"
  );

  return {
    exported: exportedNames.length,
    names: exportedNames,
    riveUrl: url,
    skipped: containerName,
  };
}
