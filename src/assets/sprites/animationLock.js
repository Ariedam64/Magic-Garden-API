// src/assets/sprites/animationLock.js

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

/**
 * Verrou d'exclusion pour l'export des animations.
 *
 * **Sur disque, et détenu par le worker.** Deux raisons, apprises l'une après
 * l'autre :
 *
 * 1. Un drapeau en mémoire ne survit pas au redémarrage du processus. Quand le
 *    jeu change de version, la sync se termine par un `process.exit(0)` et pm2
 *    relance l'API : celle-ci repart avec un drapeau vierge et forke un second
 *    export pendant que le premier tourne. Arrivé à la v830.
 * 2. Le verrou doit appartenir au **worker**, pas à celui qui le lance. Sinon
 *    `npm run export:animations` lancé à la main double un export déclenché par
 *    la sync, qui n'en sait rien.
 *
 * Le verrou porte le PID du processus qui travaille : c'est lui qu'on interroge
 * pour savoir si le travail est encore en cours, y compris quand le parent qui
 * l'a lancé a disparu entre-temps.
 */

const LOCK_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "data",
  "animation-export.lock"
);

function isAlive(pid) {
  try {
    // Signal 0 : ne tue rien, vérifie seulement l'existence du processus.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = le processus existe mais appartient à quelqu'un d'autre.
    return err?.code === "EPERM";
  }
}

/**
 * Verrou en cours de détention par un processus vivant, ou null.
 *
 * Un verrou dont le processus est mort est retiré au passage : sans ça, une
 * machine redémarrée en plein export bloquerait tous les suivants.
 */
export async function readLock() {
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(LOCK_FILE, "utf-8"));
  } catch {
    return null;
  }

  if (lock?.pid && isAlive(lock.pid)) return lock;

  logger.warn({ lock }, "Removing a stale animation export lock");
  await clearLock();
  return null;
}

/**
 * Prend le verrou pour le processus courant.
 *
 * @returns {Promise<boolean>} false si un autre export est déjà en cours
 */
export async function acquireLock(details = {}) {
  const held = await readLock();
  if (held) {
    logger.warn({ held }, "Another animation export is already running, aborting");
    return false;
  }

  try {
    await fs.mkdir(path.dirname(LOCK_FILE), { recursive: true });
    await fs.writeFile(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...details })
    );
    return true;
  } catch (err) {
    // Ne pas empêcher un export de tourner parce qu'on ne sait pas écrire le
    // verrou : le pire cas reste un doublon, pas une absence d'animations.
    logger.warn({ error: err?.message }, "Could not write the animation export lock");
    return true;
  }
}

export async function clearLock() {
  await fs.rm(LOCK_FILE, { force: true }).catch(() => {});
}
