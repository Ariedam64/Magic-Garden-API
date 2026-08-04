// src/assets/sprites/exportPetAnimations.js

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { loadRiveFile } from "./riveRenderer.js";
import { renderArtboardAnimation, encodeAnimation } from "./riveAnimator.js";
import { resolvePetsRiveUrl, ACTIVE_VARIANTS, PET_STATE_MACHINE } from "./exportPetsFromRive.js";

/**
 * Export des animations de pets depuis `rive/pets.riv`.
 *
 * À l'inverse des PNG (`exportPetsFromRive.js`), qui figent une pose, on sort
 * ici une boucle par timeline utile. Le jeu, lui, ne produit jamais de
 * fichier animé : il rejoue le Rive en direct dans le navigateur. C'est donc
 * un usage propre à l'API — servir un pet qui bouge à un client (Discord,
 * page web, overlay) qui ne va pas embarquer un runtime Rive.
 *
 * Volume et coût : compter ~1 Mo et ~12 s de CPU par espèce pour les quatre
 * clips. À déclencher quand le .riv change, jamais par requête.
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
// qui croît linéairement, ~970 Ko pour un idle de 7 s.
const CLIP_FPS = 30;

export const PET_CLIPS = [
  { id: "idle", timeline: "Pet_Idle", fps: CLIP_FPS },
  { id: "walk", timeline: "Pet_Walk", fps: CLIP_FPS },
  { id: "eat", timeline: "Pet_Eat", fps: CLIP_FPS },
  { id: "sleep", timeline: "Pet_Sleep", fps: CLIP_FPS },
];

// Sidecar écrit à côté des animations (préfixé `_` : le routeur n'accepte que
// des extensions d'image, il n'est donc jamais servi).
export const PET_ANIMATIONS_FILE = "_rive-animations.json";

export const ANIMATION_CATEGORY = "pets";

// Secondes d'amorçage quand une entrée booléenne est forcée. Même valeur que
// les images fixes : les VFX météo (flammes, éclairs) mettent ~3 s à s'établir,
// et on veut filmer le régime établi, pas la transition d'allumage.
const SETTLE_SECONDS_WITH_INPUTS = 4;

// Les variantes météo n'ont qu'un idle : leur intérêt est de montrer le pet
// sous météo active, pas de décliner tous ses états.
const VARIANT_CLIPS = ["idle"];

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
 * Liste des rendus à produire : chaque espèce × chaque clip demandé, plus les
 * variantes météo.
 */
function buildTargets(petNames, clips) {
  const wanted = clips.filter((clip) => config.animations.clips.includes(clip.id));

  const targets = [];

  for (const name of petNames) {
    for (const clip of wanted) {
      targets.push({
        artboard: name,
        name,
        clip,
        bools: null,
        settleSeconds: 0,
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
        bools: { [variant.input]: true },
        settleSeconds: SETTLE_SECONDS_WITH_INPUTS,
      });
    }
  }

  return targets;
}

function fileName(name, clipId, format) {
  return `${name}_${clipId}.${format}`;
}

/**
 * Rend les animations de pets dans `outDir/animation/pets/`.
 *
 * @param {object} options
 * @param {string} options.outDir - Racine d'export (celle des sprites)
 * @param {string|null} options.riveUrl - URL du .riv (résolue si absente)
 * @param {boolean} options.force - Re-rend même ce qui est déjà à jour
 * @param {string[]} options.formats - Formats de sortie (défaut : config)
 * @param {(progress: object) => void} options.onProgress
 * @returns {Promise<{ exported: number, skipped: number, failed: number, bytes: number, riveUrl: string|null }>}
 */
export async function exportPetAnimations({
  outDir = "./export",
  riveUrl = null,
  force = false,
  formats = config.animations.formats,
  onProgress = null,
} = {}) {
  const url = riveUrl || (await resolvePetsRiveUrl());
  if (!url) {
    logger.warn("Pets Rive file not found in manifest, skipping pet animation export");
    return { exported: 0, skipped: 0, failed: 0, bytes: 0, riveUrl: null };
  }

  // Aucun format demandé : on s'arrête avant d'écrire quoi que ce soit. Sans
  // ce garde-fou, le nettoyage de fin ne trouverait plus rien d'attendu et
  // supprimerait toutes les animations déjà générées.
  if (!formats.length) {
    logger.warn("No animation format configured, skipping pet animation export");
    return { exported: 0, skipped: 0, failed: 0, bytes: 0, riveUrl: url };
  }

  const destDir = path.join(outDir, "animation", ANIMATION_CATEGORY);
  await fs.mkdir(destDir, { recursive: true });

  const sidecarPath = path.join(destDir, PET_ANIMATIONS_FILE);
  const previous = await readSidecar(sidecarPath);
  // Le .riv est versionné par hash : une URL identique garantit un contenu
  // identique, donc les fichiers déjà écrits sont valides. C'est ce qui rend
  // l'export reprenable après une coupure, sans tout refaire.
  const reusable = !force && previous?.riveUrl === url ? previous.animations || {} : {};

  const bytes = await downloadBuffer(url);
  const { file, artboardNames } = await loadRiveFile(bytes);

  const containerName = file.defaultArtboard?.()?.name ?? null;
  const petNames = artboardNames.filter((n) => n !== containerName);
  const targets = buildTargets(petNames, PET_CLIPS);

  const animations = {};
  let exported = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  let done = 0;

  for (const target of targets) {
    const clipId = target.clip.id;

    const cached = reusable[target.name]?.[clipId];
    if (cached && (await allFilesExist(destDir, target.name, clipId, formats))) {
      animations[target.name] ??= {};
      animations[target.name][clipId] = cached;
      totalBytes += sumBytes(cached);
      skipped++;
      done++;
      continue;
    }

    try {
      const capture = await renderArtboardAnimation(file, target.artboard, {
        stateMachineName: PET_STATE_MACHINE,
        timeline: target.clip.timeline,
        bools: target.bools,
        settleSeconds: target.settleSeconds,
        fps: target.clip.fps,
        height: config.animations.height,
      });

      // Timeline absente de cette espèce : ce n'est pas une erreur, toutes
      // n'exposent pas les mêmes états.
      if (!capture) {
        logger.debug(
          { artboard: target.artboard, timeline: target.clip.timeline },
          "Pet timeline not available, skipping animation"
        );
        done++;
        continue;
      }

      const written = {};
      for (const format of formats) {
        const buffer = await encodeAnimation(capture, format);
        await fs.writeFile(path.join(destDir, fileName(target.name, clipId, format)), buffer);
        written[format] = { bytes: buffer.length };
        totalBytes += buffer.length;
      }

      animations[target.name] ??= {};
      animations[target.name][clipId] = {
        name: target.name,
        artboard: target.artboard,
        clip: clipId,
        timeline: target.clip.timeline,
        width: capture.width,
        height: capture.height,
        frames: capture.frames,
        fps: capture.fps,
        durationMs: capture.durationMs,
        anchor: capture.anchor,
        formats: written,
      };
      exported++;
    } catch (err) {
      failed++;
      logger.error(
        {
          artboard: target.artboard,
          name: target.name,
          clip: clipId,
          error: err?.message || String(err),
        },
        "Failed to render pet animation from Rive"
      );
    }

    done++;
    onProgress?.({ done, total: targets.length, name: target.name, clip: clipId });
  }

  await fs.writeFile(
    sidecarPath,
    JSON.stringify(
      {
        riveUrl: url,
        generatedAt: new Date().toISOString(),
        formats,
        height: config.animations.height,
        animations,
      },
      null,
      2
    )
  );

  await pruneStaleFiles(destDir, animations, formats);

  logger.info(
    { riveUrl: url, exported, skipped, failed, megabytes: (totalBytes / 1e6).toFixed(1) },
    "Pet animations rendered from Rive"
  );

  return { exported, skipped, failed, bytes: totalBytes, riveUrl: url };
}

async function readSidecar(sidecarPath) {
  try {
    return JSON.parse(await fs.readFile(sidecarPath, "utf-8"));
  } catch {
    return null;
  }
}

function sumBytes(entry) {
  return Object.values(entry?.formats ?? {}).reduce((sum, f) => sum + (f?.bytes || 0), 0);
}

async function allFilesExist(destDir, name, clipId, formats) {
  for (const format of formats) {
    try {
      await fs.access(path.join(destDir, fileName(name, clipId, format)));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Supprime les animations qui ne sont plus référencées.
 *
 * Sans ça, un pet retiré du jeu ou un clip désactivé par configuration
 * laisserait un fichier orphelin servi indéfiniment — et ces fichiers pèsent
 * lourd.
 */
async function pruneStaleFiles(destDir, animations, formats) {
  const expected = new Set([PET_ANIMATIONS_FILE]);
  for (const [name, clips] of Object.entries(animations)) {
    for (const clipId of Object.keys(clips)) {
      for (const format of formats) expected.add(fileName(name, clipId, format));
    }
  }

  let removed = 0;
  for (const entry of await fs.readdir(destDir)) {
    if (expected.has(entry)) continue;
    await fs.rm(path.join(destDir, entry), { force: true });
    removed++;
  }

  if (removed) logger.info({ removed, destDir }, "Pruned stale pet animations");
}
