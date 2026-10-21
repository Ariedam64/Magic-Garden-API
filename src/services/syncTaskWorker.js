// src/services/syncTaskWorker.js

import { realpathSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Processus fils qui exécute **une** tâche lourde de la sync, puis meurt.
 *
 * Lancé par `syncTaskRunner.js`, jamais à la main : il attend un message
 * `{ task, args }` sur le canal IPC, répond `{ ok, result | error }`, et sort.
 *
 * Pourquoi un processus, et un processus par tâche :
 *
 * - **La mémoire revient au système.** Le runtime Rive et le transcodeur KTX2
 *   sont des modules WASM dont la mémoire ne rétrécit jamais, et libvips/Skia
 *   laissent derrière eux des arènes malloc de plusieurs dizaines de Mo. Dans
 *   l'API, tout ça restait à vie (100-235 Mo de WASM, ~390 Mo d'arènes) et
 *   finissait en swap. Ici, la sortie du processus rend tout.
 * - **Un blocage se tue.** Dans un processus déjà chaud (des heures
 *   d'uptime, un rendu Rive dans la foulée), l'export des décors puis la
 *   découpe des atlas ne rendaient plus jamais la main : la sync restait
 *   suspendue jusqu'au délai de garde de 15 min, qui redémarrait toute l'API.
 *   Le même export, dans un processus neuf, prend 35 s. Une tâche bornée par
 *   un `SIGKILL` ne peut plus emporter l'API avec elle.
 * - **La boucle d'événements de l'API reste libre.** Le rendu des PNG de pets
 *   est du WASM synchrone (~36 s) : en processus, il faisait monter les
 *   requêtes à plus de 2 s.
 *
 * Les modules de chaque tâche sont importés à la demande : un fils ne charge
 * que ce dont sa tâche a besoin.
 */

const TASKS = {
  // Inventaire des .riv du manifest (artboards, timelines, entrées).
  async riveInventory({ baseUrl = null, force = false } = {}) {
    const { syncRiveInventory } = await import("./riveSync.js");
    return syncRiveInventory({ baseUrl, force });
  },

  // PNG des pets, rendus depuis les .riv de pets.
  async petSprites({ outDir, riveUrls = null } = {}) {
    const { exportPetsFromRive } = await import("../assets/sprites/exportPetsFromRive.js");
    return exportPetsFromRive({ outDir, riveUrls });
  },

  // PNG des décors que les atlas ne fournissent pas, rendus depuis decor.riv.
  async decorSprites({ outDir, riveUrl = null } = {}) {
    const { exportDecorFromRive } = await import("../assets/sprites/exportDecorFromRive.js");
    return exportDecorFromRive({ outDir, riveUrl });
  },

  // Sprites découpés des atlas (KTX2 décodés, 45-64 Mo pièce).
  async atlasSprites({ outDir, restoreTrim = true, onlyKeys = null } = {}) {
    const { exportSpritesToDisk } = await import("../assets/sprites/exportSpritesToDisk.js");
    return exportSpritesToDisk({
      outDir,
      restoreTrim,
      onlyKeys: Array.isArray(onlyKeys) ? new Set(onlyKeys) : null,
    });
  },
};

function reply(message) {
  const code = message.ok ? 0 : 1;
  // Le canal peut s'être fermé (parent mort) : on sort quoi qu'il arrive.
  const exit = () => process.exit(code);
  try {
    process.send(message, exit);
  } catch {
    exit();
  }
  setTimeout(exit, 5000).unref();
}

// Seulement en tant que point d'entrée d'un fork : sous pm2, l'API elle-même a
// un canal IPC (`process.send` existe), et un import accidentel de ce module y
// brancherait ces gestionnaires — dont un `exit` à la déconnexion.
function isEntryPoint() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}


if (process.send && isEntryPoint()) {
  // L'API tourne sur la même machine (2 vCPU) : on s'efface devant elle,
  // comme l'export des animations.
  try {
    os.setPriority(0, 10);
  } catch {
    // Pas critique.
  }

  // Parent disparu (redémarrage, délai de garde) : pas de travail orphelin.
  process.on("disconnect", () => process.exit(1));

  process.once("message", async (message) => {
    const { task, args } = message ?? {};
    const run = TASKS[task];

    if (!run) {
      reply({ ok: false, error: `Unknown sync task '${task}'` });
      return;
    }

    try {
      reply({ ok: true, result: await run(args ?? {}) });
    } catch (err) {
      reply({ ok: false, error: err?.message || String(err) });
    }
  });
}
