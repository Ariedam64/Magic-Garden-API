// src/assets/sprites/riveRenderer.js

import { createCanvas, Path2D, Image, DOMMatrix, ImageData } from "@napi-rs/canvas";
import { logger } from "../../logger/index.js";

/**
 * Rasterise des artboards Rive côté serveur.
 *
 * Depuis la maj du jeu qui bascule les pets de l'atlas TexturePacker vers du
 * vectoriel Rive (`rive/pets.riv`), les PNG des pets n'existent plus nulle part
 * dans les assets : le jeu les rend à la volée dans le navigateur. Pour
 * continuer à servir des PNG, on refait ce rendu ici.
 *
 * Le runtime officiel `@rive-app/canvas-advanced-single` est un module WASM
 * pensé pour le navigateur : il touche `document`, `Path2D`, `DOMMatrix`… donc
 * on lui fournit un DOM minimal adossé à `@napi-rs/canvas` (binaires
 * précompilés — pas de toolchain native à installer sur le serveur).
 */

let rivePromise = null;

/**
 * Crée un canvas dont `getContext` ne répond que pour "2d".
 *
 * Le runtime sonde `webgl2`/`webgl` au démarrage pour choisir son renderer.
 * `@napi-rs/canvas` lève sur ces types au lieu de renvoyer `null`, ce qui
 * ferait échouer l'init — on répond donc `null` nous-mêmes pour l'aiguiller
 * vers le renderer Canvas2D (le seul dont on a besoin ici).
 */
function makeShimmedCanvas(width = 1, height = 1) {
  const canvas = createCanvas(width, height);
  const getContext = canvas.getContext.bind(canvas);
  canvas.getContext = (type) => (type === "2d" ? getContext("2d") : null);
  return canvas;
}

function installDomShims() {
  if (globalThis.document?.__riveShim) return;

  globalThis.Path2D ??= Path2D;
  globalThis.Image ??= Image;
  globalThis.DOMMatrix ??= DOMMatrix;
  globalThis.ImageData ??= ImageData;
  globalThis.navigator ??= { userAgent: "node" };
  globalThis.window ??= globalThis;
  globalThis.document = {
    __riveShim: true,
    createElement: (tag) => (tag === "canvas" ? makeShimmedCanvas() : {}),
    body: { appendChild() {} },
  };
}

/**
 * Initialise (une seule fois) le runtime Rive.
 */
export async function getRive() {
  if (rivePromise) return rivePromise;

  rivePromise = (async () => {
    installDomShims();
    const { default: RiveFactory } = await import("@rive-app/canvas-advanced-single");
    const rive = await RiveFactory();
    logger.debug("Rive runtime initialized");
    return rive;
  })().catch((err) => {
    rivePromise = null;
    throw err;
  });

  return rivePromise;
}

/**
 * Charge un fichier .riv et retourne la liste des noms d'artboards.
 *
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<{ file: object, artboardNames: string[] }>}
 */
export async function loadRiveFile(bytes) {
  const rive = await getRive();
  const file = await rive.load(new Uint8Array(bytes));

  const artboardNames = [];
  for (let i = 0; i < file.artboardCount(); i++) {
    artboardNames.push(file.artboardByIndex(i).name);
  }

  return { file, artboardNames };
}

/**
 * Rend un artboard en PNG.
 *
 * @param {object} file - Fichier Rive chargé via loadRiveFile
 * @param {string} artboardName
 * @param {object} options
 * @param {string|null} options.stateMachineName - State machine à instancier
 * @param {Record<string, boolean>} options.inputs - Inputs booléens à forcer
 * @param {number} options.settleFrames - Frames à avancer avant capture
 * @param {number} options.scale - Multiplicateur de résolution
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }|null>}
 *   PNG non rogné aux dimensions de l'artboard, ou null si l'artboard manque
 */
export async function renderArtboardToPng(
  file,
  artboardName,
  {
    stateMachineName = null,
    inputs = null,
    settleFrames = 240,
    scale = 1,
  } = {}
) {
  const rive = await getRive();

  const artboard = file.artboardByName(artboardName);
  if (!artboard) return null;

  const bounds = artboard.bounds;
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * scale));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * scale));

  const canvas = makeShimmedCanvas(width, height);
  const renderer = rive.makeRenderer(canvas);

  let machine = null;
  try {
    const machineDef = stateMachineName ? artboard.stateMachineByName(stateMachineName) : null;

    if (machineDef) {
      machine = new rive.StateMachineInstance(machineDef, artboard);

      if (inputs) {
        for (let i = 0; i < machine.inputCount(); i++) {
          const input = machine.input(i);
          const value = inputs[input.name];
          if (typeof value === "boolean") input.asBool().value = value;
        }
      }

      // On avance d'un nombre fixe de frames : la state machine part de son
      // état d'entrée, les transitions/idle se stabilisent, et le résultat
      // reste déterministe d'un export à l'autre.
      for (let i = 0; i < settleFrames; i++) {
        machine.advance(1 / 60);
        artboard.advance(1 / 60);
      }
    } else {
      artboard.advance(0);
    }

    renderer.clear();
    renderer.save();
    renderer.align(
      rive.Fit.contain,
      rive.Alignment.center,
      { minX: 0, minY: 0, maxX: width, maxY: height },
      bounds
    );
    artboard.draw(renderer);
    renderer.restore();

    // Indispensable avec le renderer Canvas2D : `flush()` seul ne valide pas
    // la frame, le canvas resterait entièrement transparent.
    rive.resolveAnimationFrame();

    return { buffer: canvas.toBuffer("image/png"), width, height };
  } finally {
    machine?.delete?.();
    renderer.delete?.();
  }
}
