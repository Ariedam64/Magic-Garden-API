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

// Valeurs reprises telles quelles du jeu (cf. doc-rive.md §3) : seuil alpha du
// cadrage, et pas d'avance de la séquence d'amorçage. Le pas n'est pas
// cosmétique — avancer 4 s d'un coup ne donne pas la même frame que huit fois
// 0,5 s.
export const ALPHA_THRESHOLD = 16;
export const SETTLE_STEP_SECONDS = 0.5;

// Balayage du cycle d'idle. Il se fait sur un canvas réduit : on ne compare
// que des poses entre elles, la résolution finale n'apporte rien et coûte cher.
// Borne de chargement d'un .riv (voir loadRiveFile : un fichier illisible ne
// rejette pas, il ne résout jamais).
const LOAD_TIMEOUT_MS = 60_000;

const SCAN_WIDTH = 200;
const SCAN_STEP = 6;
const DEFAULT_CYCLE_FRAMES = 420;

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
export function makeShimmedCanvas(width = 1, height = 1) {
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
 * `rive.load()` ne rejette pas sur un fichier qu'il ne sait pas lire : il
 * **ne résout jamais**. C'est le cas aujourd'hui d'`avatar.riv`, et ce sera le
 * cas de `pets.riv` le jour où le jeu passera à un format Rive plus récent que
 * notre runtime. Sans borne, ce blocage remonte jusqu'à la sync de sprites,
 * dont le timeout tue le process — donc boucle de redémarrage. On borne ici
 * pour que ça devienne une simple erreur : l'export est sauté et les PNG déjà
 * sur disque continuent d'être servis.
 *
 * @param {Buffer|Uint8Array} bytes
 * @param {object} options
 * @param {number} options.timeoutMs
 * @returns {Promise<{ file: object, artboardNames: string[] }>}
 */
export async function loadRiveFile(bytes, { timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const rive = await getRive();

  let timer;
  const file = await Promise.race([
    rive.load(new Uint8Array(bytes)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Rive load timed out after ${timeoutMs}ms — the file is likely in a newer format than the pinned runtime`
            )
          ),
        timeoutMs
      );
    }),
  ]).finally(() => clearTimeout(timer));

  if (!file) throw new Error("Rive load returned no file");

  const artboardNames = [];
  for (let i = 0; i < file.artboardCount(); i++) {
    artboardNames.push(file.artboardByIndex(i).name);
  }

  return { file, artboardNames };
}

/**
 * Rend un artboard en PNG, cadré comme le fait le jeu.
 *
 * Le jeu bake ses propres images fixes de pets (`PetIconService`, chunk
 * `main-*.js`) et on en reprend la recette — voir doc-rive.md §3 :
 *
 *   sprite ancré (0.5, 1), hauteur `bakeHeight`, largeur = hauteur × ratio
 *   artboard ; puis cadre = bbox alpha (seuil 16) **symétrisée
 *   horizontalement autour de l'axe de l'artboard**, serrée verticalement.
 *
 * C'est cette symétrie qui donne des sujets parfaitement centrés : un pet dont
 * la queue ou l'aile dépasse d'un seul côté n'est pas décalé pour autant, ce
 * qu'un rognage serré des deux côtés ne sait pas faire.
 *
 * @param {object} file - Fichier Rive chargé via loadRiveFile
 * @param {string} artboardName
 * @param {object} options
 * @param {string|null} options.stateMachineName - State machine à instancier
 * @param {Record<string, boolean>} options.inputs - Inputs booléens à forcer
 * @param {number} options.settleSeconds - Secondes avancées après l'entrée
 * @param {"neutral"|"widest"|"game"} options.pose - Voir pickFrame ci-dessous
 * @param {string} options.cycleAnimation - Timeline dont on balaie un cycle
 * @param {number|null} options.bakeHeight - Hauteur de rendu avant cadrage
 * @returns {Promise<{ buffer, width, height, anchor }|null>}
 *   PNG cadré, ou null si l'artboard n'existe pas
 */
export async function renderArtboardToPng(
  file,
  artboardName,
  {
    stateMachineName = null,
    inputs = null,
    settleSeconds = 0,
    pose = "neutral",
    cycleAnimation = "Pet_Idle",
    bakeHeight = null,
  } = {}
) {
  const rive = await getRive();

  const artboard = file.artboardByName(artboardName);
  if (!artboard) return null;

  const bounds = artboard.bounds;
  const artboardWidth = bounds.maxX - bounds.minX;
  const artboardHeight = bounds.maxY - bounds.minY;

  // Le jeu bake à 512 px de haut, taille dictée par son budget d'atlas GPU.
  // On rend à la hauteur native de l'artboard : le cadrage est identique au
  // pixel près (il ne dépend que de ratios), mais l'image est plus fine.
  const height = Math.max(1, Math.round(bakeHeight ?? artboardHeight));
  const width = Math.max(1, Math.round((height * artboardWidth) / artboardHeight));

  const canvas = makeShimmedCanvas(width, height);
  const context = canvas.getContext("2d");
  const renderer = rive.makeRenderer(canvas);

  const machineDef = stateMachineName ? artboard.stateMachineByName(stateMachineName) : null;

  // Sans state machine, l'artboard rend sa pose d'édition : le pet apparaît
  // petit et son ombre au sol réapparaît. C'est un PNG parfaitement valide,
  // donc une renommage de la state machine côté jeu passerait inaperçu et
  // corromprait les 28 sprites en silence. On préfère échouer : l'appelant
  // loguera et sautera ce pet, et l'ancien PNG reste servi.
  if (stateMachineName && !machineDef) {
    renderer.delete?.();
    throw new Error(
      `State machine '${stateMachineName}' not found on artboard '${artboardName}'`
    );
  }

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

  // Séquence d'amorçage du jeu (`RiveSprite.hydrate`) : un `advance(0)` pour
  // appliquer l'état d'entrée, puis `settleSeconds` consommées par pas de
  // SETTLE_STEP_SECONDS. Le pas compte — avancer 4 s d'un coup ou en huit fois
  // ne donne pas la même frame.
  const settle = (machine, seconds) => {
    machine.advance(0);
    artboard.advance(0);

    let remaining = seconds;
    while (remaining > 0) {
      const step = Math.min(remaining, SETTLE_STEP_SECONDS);
      machine.advance(step);
      artboard.advance(step);
      remaining -= step;
    }
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
      return frameLikeGame(canvas, context, width, height);
    }

    machine = makeMachine();
    settle(machine, settleSeconds);

    if (pose === "game") {
      drawFrame();
      return frameLikeGame(canvas, context, width, height);
    }

    // Un cycle de la timeline d'idle, mesuré à basse résolution : on ne compare
    // que des poses, la finesse est inutile et coûteuse.
    const cycleFrames = animationFrameCount(artboard, cycleAnimation) ?? DEFAULT_CYCLE_FRAMES;
    const scanCanvas = makeShimmedCanvas(SCAN_WIDTH, Math.round((SCAN_WIDTH * height) / width));
    const scanContext = scanCanvas.getContext("2d");
    const scanRenderer = rive.makeRenderer(scanCanvas);

    const samples = [];
    try {
      for (let frame = 0; frame < cycleFrames; frame++) {
        if (frame % SCAN_STEP === 0) {
          scanRenderer.clear();
          scanRenderer.save();
          scanRenderer.align(
            rive.Fit.contain,
            rive.Alignment.center,
            { minX: 0, minY: 0, maxX: scanCanvas.width, maxY: scanCanvas.height },
            bounds
          );
          artboard.draw(scanRenderer);
          scanRenderer.restore();
          rive.resolveAnimationFrame();

          samples.push({
            frame,
            ...measureFrame(scanContext, scanCanvas.width, scanCanvas.height),
          });
        }
        machine.advance(1 / 60);
        artboard.advance(1 / 60);
      }
    } finally {
      scanRenderer.delete?.();
    }

    const chosen = pickFrame(samples, pose);

    // `advance` est déterministe : rejouer la même séquence sur une instance
    // neuve redonne exactement la frame mesurée.
    machine.delete?.();
    machine = makeMachine();
    settle(machine, settleSeconds);

    for (let i = 0; i < (chosen ?? 0); i++) {
      machine.advance(1 / 60);
      artboard.advance(1 / 60);
    }
    drawFrame();

    return frameLikeGame(canvas, context, width, height);
  } finally {
    machine?.delete?.();
    renderer.delete?.();
  }
}

/**
 * Applique le cadrage du jeu au canvas rendu.
 *
 * @returns {{ buffer: Buffer, width: number, height: number, anchor: {x,y} }}
 */
function frameLikeGame(canvas, context, width, height) {
  const box = alphaBounds(context, width, height);

  // Canvas entièrement transparent : on rend l'image telle quelle plutôt que
  // de lever — l'appelant loguera un sprite vide, c'est plus diagnosticable.
  if (!box) {
    return {
      buffer: canvas.toBuffer("image/png"),
      width,
      height,
      anchor: { x: 0.5, y: 1 },
    };
  }

  const centerX = width / 2;
  const half = Math.max(centerX - box.x, box.x + box.width - centerX);

  const left = Math.max(0, Math.round(centerX - half));
  const cropWidth = Math.min(width - left, Math.max(1, Math.round(2 * half)));

  const cropped = makeShimmedCanvas(cropWidth, box.height);
  cropped
    .getContext("2d")
    .drawImage(canvas, left, box.y, cropWidth, box.height, 0, 0, cropWidth, box.height);

  return {
    buffer: cropped.toBuffer("image/png"),
    width: cropWidth,
    height: box.height,
    // x vaut 0.5 par construction (c'est tout l'intérêt de la symétrie) ;
    // y place le sol de l'artboard, qui tombe sous les pattes — d'où le clamp.
    anchor: {
      x: 0.5,
      y: Math.min(1, (height - box.y) / box.height),
    },
  };
}

/**
 * Bounding box du contenu non transparent.
 */
export function alphaBounds(context, width, height) {
  const { data } = context.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
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
      if (alpha < ALPHA_THRESHOLD) continue;

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
 * Nombre de frames d'une timeline de l'artboard, si elle existe.
 */
function animationFrameCount(artboard, name) {
  if (!name) return null;
  try {
    const animation = artboard.animationByName(name);
    return animation?.duration || null;
  } catch {
    return null;
  }
}

/**
 * Choisit la frame à exporter parmi les frames échantillonnées.
 *
 * Le jeu, lui, ne désigne aucune frame : son baker capture la frame 0 de
 * `Pet_Idle` (`advanceZero()`, et `draw()` n'avance pas au premier appel).
 * Or `Pet_Idle` est une boucle de 7 s et sa frame 0 tombe sur un extrême du
 * balancement — corps de travers, éventail du paon replié. Les anciens
 * sprites d'atlas, eux, étaient sur une pose neutre.
 *
 * On prend donc la frame la plus proche de la **médiane pixel à pixel** du
 * cycle : le pet passe l'essentiel de son idle autour de sa pose de repos, et
 * les écarts (balancement, clignements, battements d'ailes) sont des outliers
 * qui s'éliminent tout seuls. Aucun réglage par espèce, donc un pet ajouté par
 * une maj est traité correctement sans intervention.
 *
 * `pose: "widest"` restreint d'abord aux frames les plus larges. Réservé aux
 * variantes météo, que le jeu n'a jamais bakées : sans ça les éclairs et les
 * flammes sont attrapés à un creux de leur pulsation.
 *
 * @returns {number|null} index de frame (relatif au début du balayage)
 */
function pickFrame(samples, pose = "neutral") {
  if (!samples.length) return null;

  const maxSpan = Math.max(...samples.map((s) => s.span));
  if (maxSpan <= 0) return null;

  const candidates =
    pose === "widest"
      ? samples.filter((s) => s.span >= maxSpan * SPAN_TOLERANCE)
      : samples;

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
