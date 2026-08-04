#!/usr/bin/env node
// scripts/exportPetAnimations.js

import os from "node:os";
import { config } from "../src/config/index.js";
import { logger } from "../src/logger/index.js";
import { exportPetAnimations } from "../src/assets/sprites/exportPetAnimations.js";
import { exportDecorAnimations } from "../src/assets/sprites/exportDecorAnimations.js";

/**
 * Génère les boucles animées des pets.
 *
 * Volontairement un exécutable à part : le rendu est du WASM synchrone, une
 * trentaine d'espèces représentent plusieurs minutes de CPU d'affilée, et le
 * faire dans le processus de l'API bloquerait sa boucle d'événements tout ce
 * temps. `services/animationSync.js` lance donc ce script en processus fils
 * quand le .riv change ; on peut aussi l'appeler à la main :
 *
 *   npm run export:animations -- --force --formats=webp,gif
 */

const EXPORTERS = { pets: exportPetAnimations, decor: exportDecorAnimations };

function parseArgs(argv) {
  const args = { force: false, formats: null, url: null, only: null };

  for (const arg of argv) {
    if (arg === "--force") args.force = true;
    else if (arg.startsWith("--formats=")) {
      args.formats = arg
        .slice("--formats=".length)
        .split(",")
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg.startsWith("--url=")) args.url = arg.slice("--url=".length);
    else if (arg.startsWith("--only=")) args.only = arg.slice("--only=".length).trim();
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

// L'API tourne sur la même machine (2 vCPU) : on s'efface devant elle.
try {
  os.setPriority(0, 10);
} catch {
  // Pas critique — certains environnements refusent le changement de priorité.
}

const startedAt = Date.now();

const categories = args.only ? [args.only] : Object.keys(EXPORTERS);

for (const category of categories) {
  if (!EXPORTERS[category]) {
    logger.error({ category, known: Object.keys(EXPORTERS) }, "Unknown animation category");
    process.exit(1);
  }
}

let failed = 0;
let exported = 0;
let bytes = 0;

for (const category of categories) {
  try {
    const result = await EXPORTERS[category]({
      outDir: config.sprites.exportDir,
      // L'URL forcée ne vaut que pour un export ciblé : deux catégories ne
      // partagent pas le même fichier.
      riveUrl: categories.length === 1 ? args.url : null,
      force: args.force,
      formats: args.formats || config.animations.formats,
      onProgress: ({ done, total, name, clip }) => {
        logger.debug({ category, done, total, name, clip }, "Animation progress");
      },
    });

    exported += result.exported;
    failed += result.failed;
    bytes += result.bytes;

    logger.info(
      { category, ...result, megabytes: (result.bytes / 1e6).toFixed(1) },
      "Animation export finished"
    );
  } catch (err) {
    failed++;
    logger.error(
      { category, error: err?.message || String(err) },
      "Animation export failed"
    );
  }
}

logger.info(
  {
    categories,
    exported,
    failed,
    megabytes: (bytes / 1e6).toFixed(1),
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
  },
  "Animation export complete"
);

process.exit(failed > 0 && exported === 0 ? 1 : 0);
