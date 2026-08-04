// src/services/animationSync.js

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import { getPetAnimations, clearPetAnimationsCache } from "../assets/sprites/riveAnimations.js";

/**
 * Déclenchement des animations de pets, en tâche de fond.
 *
 * Le rendu Rive est du WASM synchrone : rasteriser ~30 espèces × 4 clips,
 * c'est plusieurs minutes pendant lesquelles la boucle d'événements de l'API
 * ne rendrait plus la main. On délègue donc à un processus fils, sans
 * l'attendre — la sync de sprites n'est pas retardée, et les animations déjà
 * sur disque continuent d'être servies pendant la regénération.
 *
 * Le travail est piloté par l'URL du .riv, versionnée par hash de contenu :
 * inchangée, il n'y a rien à refaire.
 */

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "exportPetAnimations.js"
);

let running = null;

/**
 * Lance l'export des animations si le .riv a changé.
 *
 * @param {object} options
 * @param {string|null} options.riveUrl - URL du .riv courant (résolue par l'appelant)
 * @param {boolean} options.force - Regénère même si le .riv est inchangé
 * @returns {Promise<{ started: boolean, reason?: string }>}
 */
export async function syncPetAnimations({ riveUrl = null, force = false } = {}) {
  if (!config.animations.enabled) {
    return { started: false, reason: "disabled" };
  }

  if (running) {
    logger.debug("Pet animation export already running, skipping");
    return { started: false, reason: "already_running" };
  }

  // Sans URL résolue on ne sait pas s'il y a quoi que ce soit à refaire, et le
  // fils irait la chercher pour rien : on s'abstient, comme le fait l'export
  // des PNG.
  if (!riveUrl && !force) {
    return { started: false, reason: "rive_url_unknown" };
  }

  if (!force && riveUrl) {
    const { riveUrl: generatedFrom } = await getPetAnimations();
    if (generatedFrom === riveUrl) {
      logger.debug({ riveUrl }, "Pet animations already generated for this Rive file");
      return { started: false, reason: "unchanged" };
    }
  }

  const args = [];
  if (force) args.push("--force");
  if (riveUrl) args.push(`--url=${riveUrl}`);

  logger.info({ riveUrl, force }, "Starting pet animation export in background");

  const child = fork(SCRIPT, args, {
    // Le fils écrit ses propres logs (même logger, même format) ; on hérite
    // donc de stdio plutôt que de le faire transiter par des messages.
    stdio: "inherit",
    detached: false,
  });

  running = child;

  child.on("exit", async (code, signal) => {
    running = null;
    // Le sidecar vient de changer : sans ça, l'API servirait son ancien
    // catalogue jusqu'à expiration du cache.
    clearPetAnimationsCache();

    // `/data/pets` garde ses entrées transformées en cache, purgées seulement
    // au changement de version. Or l'export vient de se terminer bien après ce
    // changement : sans cette purge, les boucles fraîchement rendues
    // n'apparaîtraient qu'au prochain redémarrage. Import différé pour ne pas
    // créer de dépendance d'un service vers une route.
    try {
      const { clearTransformedDataCache } = await import("../api/routes/data.js");
      clearTransformedDataCache();
    } catch (err) {
      logger.warn({ error: err?.message }, "Could not invalidate transformed data cache");
    }

    if (code === 0) logger.info("Pet animation export completed");
    else logger.error({ code, signal }, "Pet animation export exited with an error");
  });

  child.on("error", (err) => {
    running = null;
    logger.error({ error: err?.message || String(err) }, "Failed to start pet animation export");
  });

  return { started: true };
}

/**
 * Indique si un export est en cours (exposé par /health).
 */
export function isAnimationExportRunning() {
  return running !== null;
}
