// src/services/animationSync.js

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import { getAnimations, clearAnimationsCache } from "../assets/sprites/riveAnimations.js";
import { readLock, clearLock } from "../assets/sprites/animationLock.js";

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
 *
 * **Le verrou est sur disque, pas en mémoire.** Un simple drapeau de module ne
 * suffit pas : quand le jeu change de version, la sync se termine par un
 * `process.exit(0)` et pm2 relance l'API. Le processus qui redémarre repart
 * donc avec un drapeau vierge, refait sa sync, et forke un **second** export
 * pendant que le premier tourne encore — deux rendus de ~50 min en concurrence
 * sur 2 vCPU, et deux écritures du même sidecar. C'est arrivé à la v830.
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

  const held = await readLock();
  if (held) {
    logger.info({ lock: held }, "Pet animation export already running in another process");
    return { started: false, reason: "already_running" };
  }

  // Sans URL résolue on ne sait pas s'il y a quoi que ce soit à refaire, et le
  // fils irait la chercher pour rien : on s'abstient, comme le fait l'export
  // des PNG.
  if (!riveUrl && !force) {
    return { started: false, reason: "rive_url_unknown" };
  }

  if (!force && riveUrl) {
    const { riveUrl: generatedFrom } = await getAnimations("pets");
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
    clearAnimationsCache();

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

  child.on("error", async (err) => {
    running = null;
    await clearLock();
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
