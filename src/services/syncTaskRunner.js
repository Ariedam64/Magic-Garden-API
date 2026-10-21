// src/services/syncTaskRunner.js

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger/index.js";

/**
 * Exécute une tâche lourde de la sync dans un processus fils éphémère, tué au
 * délai (voir syncTaskWorker.js pour le pourquoi).
 *
 * La promesse ne se résout qu'à la **sortie** du fils, pas à la réception de
 * son résultat : la tâche suivante ne démarre donc jamais pendant que la
 * précédente libère encore sa mémoire, et deux rendus ne se chevauchent pas
 * sur les 2 vCPU.
 */

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "syncTaskWorker.js");

// Fils en cours, pour pouvoir les tuer à l'arrêt de l'API ou au délai de garde.
const active = new Set();

export class SyncTaskError extends Error {
  constructor(message, { task, timedOut = false } = {}) {
    super(message);
    this.name = "SyncTaskError";
    this.task = task;
    this.timedOut = timedOut;
  }
}

/**
 * @param {string} task - Nom de la tâche (cf. TASKS dans syncTaskWorker.js)
 * @param {object} args - Arguments, sérialisés par le canal IPC
 * @param {object} options
 * @param {number} options.timeoutMs - Au-delà, le fils reçoit SIGKILL
 * @param {string} options.workerPath - Script du fils (surchargé par les tests)
 * @returns {Promise<any>} le résultat de la tâche
 */
export function runSyncTask(task, args = {}, { timeoutMs, workerPath = WORKER } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TypeError("runSyncTask needs a positive timeoutMs"));
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let reply = null;
    let timedOut = false;
    let settled = false;

    // stdout/stderr hérités : le fils écrit ses logs dans le même flux (pm2).
    const child = fork(workerPath, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    active.add(child);

    const settle = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active.delete(child);
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      logger.error(
        { task, pid: child.pid, timeoutMs },
        "Sync task timed out, killing its process"
      );
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("message", (message) => {
      reply = message;
    });

    child.on("error", (err) => {
      // Sans pid, le fork lui-même a échoué (ENOMEM, EAGAIN…) et "exit" peut
      // ne jamais venir. Les autres erreurs (envoi, kill) laissent "exit"
      // conclure.
      if (!child.pid) {
        settle(new SyncTaskError(`Could not start sync task '${task}': ${err.message}`, { task }));
      } else {
        logger.warn({ task, error: err?.message }, "Sync task process error");
      }
    });

    child.on("exit", (code, signal) => {
      const elapsedMs = Date.now() - startedAt;

      if (timedOut) {
        settle(
          new SyncTaskError(
            `Sync task '${task}' timed out after ${Math.round(timeoutMs / 1000)}s`,
            { task, timedOut: true }
          )
        );
        return;
      }

      if (reply?.ok) {
        logger.debug({ task, elapsedMs }, "Sync task finished");
        settle(null, reply.result);
        return;
      }

      settle(
        new SyncTaskError(
          reply?.error ||
            `Sync task '${task}' exited without a result (code ${code}, signal ${signal})`,
          { task }
        )
      );
    });

    child.send({ task, args }, (err) => {
      if (err) logger.warn({ task, error: err.message }, "Could not hand the task to its process");
    });
  });
}

/**
 * Tue les tâches en cours (arrêt de l'API, délai de garde de la sync).
 */
export function killSyncTasks(signal = "SIGKILL") {
  for (const child of active) {
    try {
      child.kill(signal);
    } catch {
      // Déjà mort.
    }
  }
}

/**
 * Nombre de tâches en cours (exposé pour les tests et le diagnostic).
 */
export function runningSyncTasks() {
  return active.size;
}
