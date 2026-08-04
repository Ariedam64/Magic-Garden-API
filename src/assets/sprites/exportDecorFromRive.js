// src/assets/sprites/exportDecorFromRive.js

import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../logger/index.js";
import { loadRiveFile, renderArtboardToPng } from "./riveRenderer.js";
import { resolveRiveUrl } from "./riveManifest.js";
import { initSprites, lookupSprite } from "./sprites.js";
import { RIVE_FRAMES_FILE } from "./riveFrames.js";

/**
 * Images fixes des décors qui n'existent que dans `rive/decor.riv`.
 *
 * Contrairement aux pets, les décors n'ont pas quitté les atlas : six des huit
 * décors animés y ont toujours leur PNG officiel, et c'est celui-là qu'il faut
 * servir. **On ne rend donc que ce qui manque** — aujourd'hui `WeatherStation`
 * et `BoobooBooth`, deux décors présents dans le fichier Rive mais que le jeu
 * n'a pas encore sortis, et qui n'avaient jusqu'ici qu'une animation pour toute
 * représentation.
 *
 * Le jour où le jeu les publiera, leur frame d'atlas apparaîtra et ce module
 * cessera de les rendre : le PNG officiel prime toujours sur notre rasterisation.
 */

const DECOR_RIVE_KEY = "decor";
const ATLAS_KEY_PREFIX = "sprite/decor/";

/**
 * Un décor est-il déjà fourni par les atlas du jeu ?
 *
 * On interroge l'index d'atlas plutôt que le disque : c'est la source qui fait
 * autorité, et elle ne dépend pas de l'ordre dans lequel les exports tournent.
 */
async function atlasProvides(name) {
  try {
    await initSprites();
    return Boolean(lookupSprite(`${ATLAS_KEY_PREFIX}${name}`));
  } catch (err) {
    logger.warn(
      { name, error: err?.message || String(err) },
      "Could not check the atlas for a decor sprite, assuming it is missing"
    );
    return false;
  }
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
 * Rend les décors absents des atlas en PNG dans `outDir/sprite/decor/`.
 *
 * @param {object} options
 * @param {string} options.outDir
 * @param {string|null} options.riveUrl
 * @returns {Promise<{ exported: number, names: string[], skipped: string[], riveUrl: string|null }>}
 */
export async function exportDecorFromRive({ outDir = "./export", riveUrl = null } = {}) {
  const url = riveUrl || (await resolveRiveUrl(DECOR_RIVE_KEY));
  if (!url) {
    logger.warn("Decor Rive file not found in manifest, skipping decor sprite export");
    return { exported: 0, names: [], skipped: [], riveUrl: null };
  }

  const bytes = await downloadBuffer(url);
  const { file, artboardNames } = await loadRiveFile(bytes);

  const destDir = path.join(outDir, "sprite", "decor");
  await fs.mkdir(destDir, { recursive: true });

  const exportedNames = [];
  const skipped = [];
  const metadata = {};

  for (const name of artboardNames) {
    if (await atlasProvides(name)) {
      skipped.push(name);
      continue;
    }

    try {
      const artboard = file.artboardByName(name);
      if (!artboard || artboard.animationCount() === 0) {
        skipped.push(name);
        continue;
      }

      // Les décors n'ont ni entrées ni états : on lit le nom de leur unique
      // timeline et celui de leur state machine plutôt que de les supposer.
      const timeline = artboard.animationByIndex(0).name;
      const stateMachineName =
        artboard.stateMachineCount() > 0 ? artboard.stateMachineByIndex(0).name : null;

      const rendered = await renderArtboardToPng(file, name, {
        stateMachineName,
        // Pose médiane du cycle, comme les pets : une frame arbitraire
        // attraperait la fontaine au creux de son jet ou le moulin de travers.
        pose: "neutral",
        cycleAnimation: timeline,
      });

      if (!rendered) {
        logger.warn({ artboard: name }, "Decor artboard render returned nothing");
        continue;
      }

      await fs.writeFile(path.join(destDir, `${name}.png`), rendered.buffer);

      metadata[`${ATLAS_KEY_PREFIX}${name}`] = {
        name,
        artboard: name,
        sourceSize: { w: rendered.width, h: rendered.height },
        anchor: rendered.anchor,
      };
      exportedNames.push(name);
    } catch (err) {
      logger.error(
        { artboard: name, error: err?.message || String(err) },
        "Failed to render decor sprite from Rive"
      );
    }
  }

  // Sidecar réécrit intégralement : un décor que le jeu vient d'ajouter à ses
  // atlas doit disparaître d'ici, sans quoi on continuerait d'annoncer notre
  // rendu à la place du PNG officiel.
  await fs.writeFile(
    path.join(destDir, RIVE_FRAMES_FILE),
    JSON.stringify({ riveUrl: url, frames: metadata }, null, 2)
  );

  logger.info(
    { riveUrl: url, exported: exportedNames.length, skipped: skipped.length },
    "Decor sprites rendered from Rive"
  );

  return { exported: exportedNames.length, names: exportedNames, skipped, riveUrl: url };
}
