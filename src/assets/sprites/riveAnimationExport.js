// src/assets/sprites/riveAnimationExport.js

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { loadRiveFile } from "./riveRenderer.js";
import {
  probeArtboardAnimation,
  renderArtboardAnimation,
  encodeAnimation,
} from "./riveAnimator.js";
import { resolveRiveUrl } from "./riveManifest.js";

/**
 * Moteur d'export des boucles animées, commun à tous les fichiers Rive.
 *
 * Ce qui change d'un fichier à l'autre tient dans une seule fonction, celle qui
 * dresse la liste des rendus à produire : les pets ont quatre clips par espèce
 * et deux variantes météo pilotées par des entrées booléennes, les décors une
 * seule boucle sans état. Tout le reste — téléchargement, reprise, encodage,
 * sidecar, nettoyage des orphelins — est identique et vit ici.
 *
 * **On ne re-rend que ce qui a réellement changé.** Un `.riv` est un binaire
 * opaque : son hash change dès qu'une virgule bouge, sans dire quoi. On compare
 * donc les pixels, pas le fichier — chaque clip porte une signature tirée de la
 * passe de repérage (cf. `probeArtboardAnimation`), combinée aux réglages de
 * rendu. Signature inchangée = fichier encodé toujours valable.
 *
 * L'arbitrage est net : le repérage coûte ~1 s par clip, le rendu final et
 * l'encodage ~40. Vérifier les 114 boucles prend quelques minutes ; les
 * réencoder en prend cinquante.
 */

// Sidecar écrit dans chaque catégorie (préfixé `_` : les routeurs n'acceptent
// que des extensions d'image, il n'est donc jamais servi).
export const ANIMATIONS_SIDECAR = "_rive-animations.json";

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function fileName(name, clipId, format) {
  return `${name}_${clipId}.${format}`;
}

/**
 * Signature d'un clip : ce qu'il montre, et comment on l'encode.
 *
 * L'empreinte des pixels ne suffit pas — changer `PET_ANIMATIONS_HEIGHT` ou la
 * qualité ne change rien à l'animation mais tout au fichier. Les réglages font
 * donc partie de la signature, sinon un changement de configuration ne serait
 * jamais appliqué.
 */
function clipSignature(fingerprint, formats) {
  const settings = JSON.stringify({
    height: config.animations.height,
    quality: config.animations.quality,
    formats: [...formats].sort(),
  });
  return createHash("md5").update(`${fingerprint}|${settings}`).digest("hex").slice(0, 12);
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
 * Sans ça, un artboard retiré du jeu ou un clip désactivé par configuration
 * laisserait un fichier orphelin servi indéfiniment — et ces fichiers pèsent
 * lourd.
 */
async function pruneStaleFiles(destDir, animations, formats) {
  const expected = new Set([ANIMATIONS_SIDECAR]);
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

  if (removed) logger.info({ removed, destDir }, "Pruned stale animations");
}

/**
 * Rend et encode toutes les boucles d'un fichier Rive.
 *
 * @param {object} options
 * @param {string} options.category - Sous-dossier de sortie (`pets`, `decor`)
 * @param {string} options.riveKey - Clé du fichier dans le manifest
 * @param {(file: object, artboardNames: string[]) => object[]} options.buildTargets
 * @param {string} options.outDir
 * @param {string|null} options.riveUrl - Résolue si absente
 * @param {boolean} options.force
 * @param {string[]} options.formats
 * @param {(progress: object) => void} options.onProgress
 * @returns {Promise<{ exported: number, skipped: number, failed: number, bytes: number, riveUrl: string|null }>}
 */
export async function exportRiveAnimations({
  category,
  riveKey,
  buildTargets,
  outDir = "./export",
  riveUrl = null,
  force = false,
  formats = config.animations.formats,
  onProgress = null,
} = {}) {
  const url = riveUrl || (await resolveRiveUrl(riveKey));
  if (!url) {
    logger.warn({ riveKey }, "Rive file not found in manifest, skipping animation export");
    return { exported: 0, skipped: 0, failed: 0, bytes: 0, riveUrl: null };
  }

  // Aucun format demandé : on s'arrête avant d'écrire quoi que ce soit. Sans
  // ce garde-fou, le nettoyage de fin ne trouverait plus rien d'attendu et
  // supprimerait toutes les animations déjà générées.
  if (!formats.length) {
    logger.warn({ riveKey }, "No animation format configured, skipping animation export");
    return { exported: 0, skipped: 0, failed: 0, bytes: 0, riveUrl: url };
  }

  const destDir = path.join(outDir, "animation", category);
  await fs.mkdir(destDir, { recursive: true });

  const sidecarPath = path.join(destDir, ANIMATIONS_SIDECAR);
  const previous = await readSidecar(sidecarPath);
  // On repart de tout ce qui a déjà été produit, quelle que soit la version du
  // .riv dont il venait : c'est la signature de chaque clip qui décide, pas
  // l'URL du fichier. Un pet inchangé traverse donc les mises à jour du jeu
  // sans être réencodé.
  const reusable = force ? {} : previous?.animations || {};

  const bytes = await downloadBuffer(url);
  const { file, artboardNames } = await loadRiveFile(bytes);
  const targets = buildTargets(file, artboardNames);

  const animations = {};
  let exported = 0;
  let skipped = 0;
  let failed = 0;
  let totalBytes = 0;
  let done = 0;

  for (const target of targets) {
    const clipId = target.clip.id;

    try {
      const probeOptions = {
        stateMachineName: target.stateMachineName ?? null,
        timeline: target.clip.timeline,
        bools: target.bools ?? null,
        settleSeconds: target.settleSeconds ?? 0,
        fps: target.clip.fps,
      };

      // Repérage d'abord : il donne le cadrage *et* l'empreinte du cycle, pour
      // quelques secondes contre ~40 pour un rendu complet.
      const probe = await probeArtboardAnimation(file, target.artboard, probeOptions);
      if (!probe) {
        logger.debug(
          { artboard: target.artboard, timeline: target.clip.timeline },
          "Timeline not available, skipping animation"
        );
        done++;
        continue;
      }

      const signature = clipSignature(probe.fingerprint, formats);
      const cached = reusable[target.name]?.[clipId];

      if (
        cached?.signature === signature &&
        (await allFilesExist(destDir, target.name, clipId, formats))
      ) {
        animations[target.name] ??= {};
        animations[target.name][clipId] = cached;
        totalBytes += sumBytes(cached);
        skipped++;
        done++;
        continue;
      }

      const capture = await renderArtboardAnimation(file, target.artboard, {
        ...probeOptions,
        height: config.animations.height,
        probe,
      });

      // Timeline absente de cet artboard : ce n'est pas une erreur, tous
      // n'exposent pas les mêmes états.
      if (!capture) {
        logger.debug(
          { artboard: target.artboard, timeline: target.clip.timeline },
          "Timeline not available, skipping animation"
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
        signature,
        formats: written,
      };
      exported++;
    } catch (err) {
      failed++;
      logger.error(
        {
          category,
          artboard: target.artboard,
          name: target.name,
          clip: clipId,
          error: err?.message || String(err),
        },
        "Failed to render animation from Rive"
      );
    }

    done++;
    onProgress?.({ category, done, total: targets.length, name: target.name, clip: clipId });
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
    {
      category,
      riveUrl: url,
      exported,
      reused: skipped,
      failed,
      megabytes: (totalBytes / 1e6).toFixed(1),
    },
    "Animations rendered from Rive"
  );

  return { exported, skipped, failed, bytes: totalBytes, riveUrl: url };
}
