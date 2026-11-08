// tests/petRiveFiles.js
//
// Charge les .riv de pets du manifest live, pour les tests d'intégration.
//
// Depuis la v1973 il n'y a plus un `pets.riv` qui les contient tous : chaque
// espèce a son fichier (`Bat.riv`, artboard `Bat`). Les tests demandent donc
// le fichier de l'espèce qu'ils rendent.

import { resolvePetsRiveFiles } from "../src/assets/sprites/riveManifest.js";
import { loadRiveFile } from "../src/assets/sprites/riveRenderer.js";

/**
 * @returns {Promise<Map<string, object>>} nom d'artboard -> fichier Rive chargé
 */
export async function loadPetRiveFiles({ timeoutMs = 30_000 } = {}) {
  const byArtboard = new Map();

  for (const { url } of await resolvePetsRiveFiles({})) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Rive download failed (${res.status}) for ${url}`);

    const { file, artboardNames } = await loadRiveFile(Buffer.from(await res.arrayBuffer()));
    // À nom égal, le premier fichier fait foi, comme à l'export.
    for (const name of artboardNames) if (!byArtboard.has(name)) byArtboard.set(name, file);
  }

  return byArtboard;
}
