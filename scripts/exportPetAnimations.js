#!/usr/bin/env node
// scripts/exportPetAnimations.js

import os from "node:os";
import { config } from "../src/config/index.js";
import { logger } from "../src/logger/index.js";
import { exportPetAnimations } from "../src/assets/sprites/exportPetAnimations.js";

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

function parseArgs(argv) {
  const args = { force: false, formats: null, url: null };

  for (const arg of argv) {
    if (arg === "--force") args.force = true;
    else if (arg.startsWith("--formats=")) {
      args.formats = arg
        .slice("--formats=".length)
        .split(",")
        .map((f) => f.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg.startsWith("--url=")) args.url = arg.slice("--url=".length);
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

try {
  const result = await exportPetAnimations({
    outDir: config.sprites.exportDir,
    riveUrl: args.url,
    force: args.force,
    formats: args.formats || config.animations.formats,
    onProgress: ({ done, total, name, clip }) => {
      logger.debug({ done, total, name, clip }, "Pet animation progress");
    },
  });

  logger.info(
    {
      ...result,
      megabytes: (result.bytes / 1e6).toFixed(1),
      elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    },
    "Pet animation export finished"
  );

  process.exit(result.failed > 0 && result.exported === 0 ? 1 : 0);
} catch (err) {
  logger.error({ error: err?.message || String(err) }, "Pet animation export failed");
  process.exit(1);
}
