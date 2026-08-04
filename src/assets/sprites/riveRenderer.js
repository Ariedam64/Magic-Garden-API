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

// Côté de la vignette utilisée pour comparer des poses entre elles.
const THUMB_SIZE = 48;

// Une frame est candidate si sa largeur atteint ce ratio de la plus large.
const SPAN_TOLERANCE = 0.97;

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
 * @param {number} options.settleFrames - Frames avancées avant l'échantillonnage
 * @param {number} options.scanFrames - Longueur du cycle échantillonné
 * @param {number} options.scanStep - Une frame retenue sur N
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
    settleFrames = 120,
    scanFrames = 300,
    scanStep = 4,
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
  const context = canvas.getContext("2d");
  const renderer = rive.makeRenderer(canvas);

  const machineDef = stateMachineName ? artboard.stateMachineByName(stateMachineName) : null;

  const makeMachine = () => {
    const instance = new rive.StateMachineInstance(machineDef, artboard);

    if (inputs) {
      for (let i = 0; i < instance.inputCount(); i++) {
        const input = instance.input(i);
        const value = inputs[input.name];
        if (typeof value === "boolean") input.asBool().value = value;
      }
    }

    return instance;
  };

  const drawFrame = () => {
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
  };

  let machine = null;
  try {
    if (!machineDef) {
      artboard.advance(0);
      drawFrame();
      return { buffer: canvas.toBuffer("image/png"), width, height };
    }

    machine = makeMachine();

    // L'idle d'un pet ne se stabilise jamais : il boucle (ailes qui battent,
    // éclairs/flammes des variantes météo, clignements d'yeux…). Figer une
    // frame arbitraire donne des poses ratées — chauve-souris ailes repliées,
    // ThunderWolf sans éclairs, chèvre les yeux fermés.
    for (let i = 0; i < settleFrames; i++) {
      machine.advance(1 / 60);
      artboard.advance(1 / 60);
    }

    // Passe 1 — on balaie un cycle en ne mesurant que les pixels (aucun
    // encodage PNG) : largeur du contenu, plus une vignette en niveaux de gris
    // qui servira à écarter les frames atypiques.
    const samples = [];

    for (let frame = 0; frame < scanFrames; frame++) {
      if (frame % scanStep === 0) {
        drawFrame();
        samples.push({ frame, ...measureFrame(context, width, height) });
      }
      machine.advance(1 / 60);
      artboard.advance(1 / 60);
    }

    const chosen = pickFrame(samples);
    if (chosen === null) {
      drawFrame();
      return { buffer: canvas.toBuffer("image/png"), width, height };
    }

    // Passe 2 — on rejoue jusqu'à la frame retenue et on encode une seule
    // fois. `advance` est déterministe, donc rejouer la même séquence sur une
    // instance neuve redonne exactement la frame mesurée.
    machine.delete?.();
    machine = makeMachine();

    for (let i = 0; i < settleFrames + chosen; i++) {
      machine.advance(1 / 60);
      artboard.advance(1 / 60);
    }
    drawFrame();

    return { buffer: canvas.toBuffer("image/png"), width, height };
  } finally {
    machine?.delete?.();
    renderer.delete?.();
  }
}

/**
 * Mesure une frame sans l'encoder : largeur du contenu opaque + vignette.
 */
function measureFrame(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);

  let minX = width;
  let maxX = -1;

  const thumb = new Uint8Array(THUMB_SIZE * THUMB_SIZE);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    const ty = Math.min(THUMB_SIZE - 1, ((y * THUMB_SIZE) / height) | 0);

    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      const alpha = data[i + 3];
      if (alpha <= 8) continue;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;

      // Luma approchée, pondérée par l'alpha : suffit à comparer des poses.
      const tx = Math.min(THUMB_SIZE - 1, ((x * THUMB_SIZE) / width) | 0);
      const luma = (data[i] * 77 + data[i + 1] * 151 + data[i + 2] * 28) >> 8;
      thumb[ty * THUMB_SIZE + tx] = (luma * alpha) / 255;
    }
  }

  return { span: maxX < minX ? 0 : maxX - minX + 1, thumb };
}

/**
 * Choisit la frame à exporter parmi les frames échantillonnées.
 *
 * 1. On ne garde que les plus larges : c'est le critère qui retrouve les poses
 *    de l'artwork d'origine (envergure maximale pour les volants, VFX déployés
 *    pour les variantes météo).
 * 2. Parmi elles, on prend la plus proche de la médiane pixel à pixel. Un
 *    clignement d'yeux ne dure que quelques frames : c'est un outlier, donc
 *    il est écarté sans avoir à le détecter explicitement.
 *
 * @returns {number|null} index de frame (relatif au début du balayage)
 */
function pickFrame(samples) {
  if (!samples.length) return null;

  const maxSpan = Math.max(...samples.map((s) => s.span));
  if (maxSpan <= 0) return null;

  const candidates = samples.filter((s) => s.span >= maxSpan * SPAN_TOLERANCE);
  if (candidates.length === 1) return candidates[0].frame;

  const pixels = THUMB_SIZE * THUMB_SIZE;
  const median = new Uint8Array(pixels);
  const column = new Uint8Array(candidates.length);

  for (let p = 0; p < pixels; p++) {
    for (let c = 0; c < candidates.length; c++) column[c] = candidates[c].thumb[p];
    median[p] = column.slice().sort()[candidates.length >> 1];
  }

  let best = candidates[0];
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    let distance = 0;
    for (let p = 0; p < pixels; p++) {
      const delta = candidate.thumb[p] - median[p];
      distance += delta * delta;
    }
    // `<` strict : à égalité on garde la frame la plus précoce, pour rester
    // reproductible d'un export à l'autre.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best.frame;
}
