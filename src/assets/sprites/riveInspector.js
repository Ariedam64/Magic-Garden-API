// src/assets/sprites/riveInspector.js

import { logger } from "../../logger/index.js";
import { getRive, loadRiveFile } from "./riveRenderer.js";

/**
 * Inventaire du contenu d'un fichier Rive.
 *
 * Ce que ça publie, c'est **ce qui ne se devine pas** et qu'un client ne doit
 * surtout pas coder en dur : le nom des artboards, celui des state machines,
 * celui des timelines, et le type de chaque entrée. Cette dernière information
 * est la plus précieuse — la moitié des entrées d'un pet sont des *triggers*
 * (`walk`, `eat`, `petted`) et non des booléens, et `asBool()` renvoie
 * silencieusement `null` dessus. C'est le piège qui coûte le plus cher à
 * découvrir soi-même.
 *
 * Tout ça change à chaque mise à jour du jeu : le publier évite à chaque client
 * de le redécouvrir, et de casser en silence.
 */

// Borne courte, volontairement plus serrée que celle du rendu : un .riv que le
// runtime ne sait pas lire ne rejette jamais, il **ne résout pas** (c'est le cas
// d'`avatar.riv`). Inspecter tout le manifest à chaque sync ne doit pas se
// payer en minutes d'attente sur les fichiers illisibles.
const INSPECT_TIMEOUT_MS = 20_000;

function describeInput(input) {
  // Le type numérique du runtime n'est pas documenté : on interroge les
  // accesseurs, qui renvoient null quand l'entrée n'est pas de ce type.
  if (input.asBool()) return "boolean";
  if (input.asTrigger()) return "trigger";
  if (input.asNumber()) return "number";
  return "unknown";
}

function describeStateMachines(rive, artboard) {
  const machines = [];

  for (let i = 0; i < artboard.stateMachineCount(); i++) {
    const definition = artboard.stateMachineByIndex(i);
    const entry = { name: definition.name, inputs: [] };

    let instance = null;
    try {
      instance = new rive.StateMachineInstance(definition, artboard);
      for (let j = 0; j < instance.inputCount(); j++) {
        const input = instance.input(j);
        entry.inputs.push({ name: input.name, type: describeInput(input) });
      }
    } catch (err) {
      logger.debug(
        { artboard: artboard.name, stateMachine: entry.name, error: err?.message },
        "Could not enumerate state machine inputs"
      );
    } finally {
      instance?.delete?.();
    }

    machines.push(entry);
  }

  return machines;
}

function describeArtboard(rive, file, name) {
  const artboard = file.artboardByName(name);
  if (!artboard) return null;

  const animations = [];
  for (let i = 0; i < artboard.animationCount(); i++) {
    const animation = artboard.animationByIndex(i);
    animations.push({
      name: animation.name,
      frames: animation.duration,
      fps: animation.fps,
      durationMs: Math.round((animation.duration / (animation.fps || 60)) * 1000),
    });
  }

  const bounds = artboard.bounds;

  return {
    name,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    animations,
    stateMachines: describeStateMachines(rive, artboard),
  };
}

/**
 * Télécharge et inspecte un fichier Rive.
 *
 * Ne lève jamais : un fichier illisible est un résultat, pas une panne. C'est
 * le cas d'`avatar.riv`, qui référence des assets hors fichier (les cosmétiques)
 * que le runtime attend qu'on lui fournisse — il ne résout donc jamais.
 *
 * @param {string} url
 * @returns {Promise<object>} description du fichier, avec `loadable`
 */
export async function inspectRiveFile(url) {
  let bytes;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { url, loadable: false, error: `download failed: ${err?.message || err}` };
  }

  try {
    const rive = await getRive();
    const { file, artboardNames } = await loadRiveFile(bytes, { timeoutMs: INSPECT_TIMEOUT_MS });

    const defaultArtboard = file.defaultArtboard?.()?.name ?? null;
    const artboards = artboardNames
      .map((name) => describeArtboard(rive, file, name))
      .filter(Boolean);

    return {
      url,
      bytes: bytes.length,
      loadable: true,
      defaultArtboard,
      artboardCount: artboards.length,
      timelineCount: artboards.reduce((sum, a) => sum + a.animations.length, 0),
      artboards,
    };
  } catch (err) {
    return { url, bytes: bytes.length, loadable: false, error: err?.message || String(err) };
  }
}
