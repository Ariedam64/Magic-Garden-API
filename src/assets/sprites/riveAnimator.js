// src/assets/sprites/riveAnimator.js

import { createHash } from "node:crypto";
import sharp from "sharp";
import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import {
  getRive,
  makeShimmedCanvas,
  alphaBounds,
  ALPHA_THRESHOLD,
  SETTLE_STEP_SECONDS,
} from "./riveRenderer.js";

/**
 * Rasterise une timeline Rive en boucle animée (WebP / GIF).
 *
 * Pendant que `riveRenderer.js` fige **une** frame (les PNG de pets),
 * ce module en capture un cycle complet. Deux différences de fond :
 *
 * 1. **On joue la timeline, pas la state machine.** La SM est instanciée et
 *    avancée de 0 — c'est elle qui pose l'échelle du pet et masque l'ombre au
 *    sol —, mais c'est ensuite une `LinearAnimationInstance` qui pilote le
 *    temps. La SM enchaîne des états au gré de ses conditions et la moitié de
 *    ses entrées sont des *triggers* (`walk`, `eat`, `petted`… cf. doc-rive.md
 *    §2) : impossible d'en tirer une boucle propre et reproductible. La
 *    timeline, elle, a une durée connue et boucle exactement sur elle-même —
 *    mesuré : première et dernière frame identiques à 0,2 % d'alpha près.
 *
 * 2. **Le cadrage est commun à toutes les frames.** Un cadre recalculé par
 *    frame ferait tressauter le sujet dans l'image. On prend donc l'union des
 *    bbox du cycle, symétrisée autour de l'axe de l'artboard comme le fait le
 *    jeu pour ses images fixes.
 */

// Passe de repérage : un cycle complet rendu petit, uniquement pour mesurer la
// place que prend le sujet. À cette taille une frame coûte ~3 ms, contre ~15 ms
// à la résolution finale — balayer tout le cycle reste négligeable, et c'est ce
// qui garantit que le cadre déduit ne rogne aucune frame.
const PROBE_HEIGHT = 160;

// Marge (en pixels de la passe de repérage) ajoutée autour de l'union des bbox,
// pour absorber l'arrondi entre les deux résolutions.
const PROBE_MARGIN = 2;

// Le sujet n'occupe qu'une fraction de son artboard (un tiers de la hauteur
// pour un poussin, la quasi-totalité pour un cheval). On rend donc chaque
// artboard à la hauteur qui donne la taille de sujet demandée, dans ces bornes.
const MIN_RENDER_HEIGHT = 64;
const MAX_RENDER_HEIGHT = 1400;

// Garde-fou contre une timeline anormalement longue (le poids du fichier croît
// linéairement avec le nombre de frames). Il doit rester au-dessus de ce que
// demandent les clips réels, sinon il rabaisse le fps en silence : le plus long
// est `Pet_Sleep`, 8 s, soit 240 frames à 30 fps.
const MAX_FRAMES = 320;

/**
 * Instancie la state machine et applique ses entrées booléennes.
 *
 * Sans elle l'artboard rend sa pose d'édition (mauvaise échelle, ombre au sol
 * visible) : un rendu parfaitement valide, donc silencieux. On lève plutôt,
 * comme le fait `renderArtboardToPng`.
 */
function instantiateMachine(rive, artboard, stateMachineName, bools, settleSeconds = 0) {
  // Certains fichiers n'en ont pas besoin : les décors sont de simples boucles
  // sans état, leur artboard se rend correctement tel quel. On ne l'exige donc
  // pas — mais si un nom est demandé et introuvable, on lève (voir plus bas).
  if (!stateMachineName) {
    artboard.advance(0);
    return null;
  }

  const definition = artboard.stateMachineByName(stateMachineName);
  if (!definition) {
    throw new Error(
      `State machine '${stateMachineName}' not found on artboard '${artboard.name}'`
    );
  }

  const machine = new rive.StateMachineInstance(definition, artboard);

  if (bools) {
    for (let i = 0; i < machine.inputCount(); i++) {
      const input = machine.input(i);
      const wanted = bools[input.name];
      if (typeof wanted !== "boolean") continue;
      // Les triggers (`walk`, `eat`…) n'ont pas de valeur booléenne : asBool()
      // renvoie null. On ne pilote que les bools (`sleep`, `fire`, `thunder`…).
      const asBool = input.asBool();
      if (asBool) asBool.value = wanted;
    }
  }

  machine.advance(0);
  artboard.advance(0);

  // Comme les images fixes : quand on force une entrée (`fire`, `thunder`,
  // `sleep`), on laisse la state machine atteindre son régime établi avant de
  // capturer, sinon on filme la transition d'entrée.
  let remaining = settleSeconds;
  while (remaining > 0) {
    const step = Math.min(remaining, SETTLE_STEP_SECONDS);
    machine.advance(step);
    artboard.advance(step);
    remaining -= step;
  }

  return machine;
}

/**
 * Découpe le cycle en frames dont les durées entières somment exactement la
 * durée de la timeline.
 *
 * Les delays d'un WebP/GIF sont des millisecondes entières : arrondir chaque
 * frame à l'identique décale la boucle (67 ms × 15 = 1005 ms). On répartit donc
 * l'arrondi sur le cycle.
 */
function frameDelays(cycleSeconds, frameCount) {
  const totalMs = cycleSeconds * 1000;
  const delays = [];
  let previous = 0;

  for (let i = 1; i <= frameCount; i++) {
    const boundary = Math.round((totalMs * i) / frameCount);
    delays.push(Math.max(1, boundary - previous));
    previous = boundary;
  }

  return delays;
}

/**
 * Joue un cycle et retourne, pour chaque frame, un callback de dessin.
 */
function playCycle(rive, artboard, machine, animation, frameCount, dt, onFrame) {
  const linear = new rive.LinearAnimationInstance(animation, artboard);

  try {
    linear.time = 0;
    linear.advance(0);
    linear.apply(1);
    artboard.advance(0);

    for (let i = 0; i < frameCount; i++) {
      onFrame(i);
      linear.advance(dt);
      linear.apply(1);
      artboard.advance(dt);
    }
  } finally {
    linear.delete?.();
  }
}

function drawTo(rive, artboard, renderer, bounds, width, height) {
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

  // Indispensable avec le renderer Canvas2D : sans ça le canvas reste
  // entièrement transparent (cf. riveRenderer.js).
  rive.resolveAnimationFrame();
}

/**
 * Passe de repérage : union des bbox du cycle, **et empreinte de son contenu**.
 *
 * L'empreinte est ce qui permet de ne pas tout refaire à chaque mise à jour du
 * jeu. Un `.riv` est un binaire opaque : son hash change dès qu'une virgule
 * bouge, sans dire *quoi* a changé. Ici on hache les pixels réellement rendus —
 * si deux versions du fichier donnent le même cycle à 160 px, l'animation est
 * visuellement identique et son fichier encodé reste valable.
 *
 * C'est rentable parce que cette passe est déjà là et coûte ~1 s, quand le
 * rendu final et l'encodage en coûtent ~40.
 */
function probeCycle(
  rive,
  artboard,
  bounds,
  stateMachineName,
  bools,
  settleSeconds,
  animation,
  frameCount,
  dt
) {
  const artboardWidth = bounds.maxX - bounds.minX;
  const artboardHeight = bounds.maxY - bounds.minY;
  const height = PROBE_HEIGHT;
  const width = Math.max(1, Math.round((height * artboardWidth) / artboardHeight));

  const canvas = makeShimmedCanvas(width, height);
  const context = canvas.getContext("2d");
  const renderer = rive.makeRenderer(canvas);
  const machine = instantiateMachine(rive, artboard, stateMachineName, bools, settleSeconds);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const digest = createHash("md5");

  try {
    playCycle(rive, artboard, machine, animation, frameCount, dt, () => {
      drawTo(rive, artboard, renderer, bounds, width, height);

      // Hachage des pixels de la frame : `advance` étant déterministe, deux
      // exécutions du même contenu donnent exactement la même empreinte.
      digest.update(Buffer.from(context.getImageData(0, 0, width, height).data));

      const box = alphaBounds(context, width, height);
      if (!box) return;
      if (box.x < minX) minX = box.x;
      if (box.y < minY) minY = box.y;
      if (box.x + box.width - 1 > maxX) maxX = box.x + box.width - 1;
      if (box.y + box.height - 1 > maxY) maxY = box.y + box.height - 1;
    });
  } finally {
    // `machine` est null quand l'artboard n'a pas de state machine (les décors).
    machine?.delete?.();
    renderer.delete?.();
  }

  if (maxX < minX) return null;

  return {
    left: Math.max(0, minX - PROBE_MARGIN) / width,
    right: Math.min(width, maxX + 1 + PROBE_MARGIN) / width,
    top: Math.max(0, minY - PROBE_MARGIN) / height,
    bottom: Math.min(height, maxY + 1 + PROBE_MARGIN) / height,
    // Même longueur que les empreintes d'atlas (cf. atlasStorage.js).
    fingerprint: digest.digest("hex").slice(0, 12),
  };
}

/**
 * Rend un cycle d'animation, cadré comme les images fixes du jeu.
 *
 * @param {object} file - Fichier Rive chargé via loadRiveFile
 * @param {string} artboardName
 * @param {object} options
 * @param {string} options.stateMachineName - State machine posant l'état de base
 * @param {string} options.timeline - Timeline à jouer (ex: `Pet_Idle`)
 * @param {Record<string, boolean>|null} options.bools - Entrées booléennes forcées
 * @param {number} options.settleSeconds - Secondes avancées avant la capture
 * @param {number} options.fps - Images par seconde visées
 * @param {number} options.height - Hauteur voulue du **sujet** (pas du canvas)
 * @param {number} options.maxFrames - Plafond de frames (borne la taille du fichier)
 * @returns {Promise<object|null>} capture, ou null si la timeline n'existe pas
 */
function prepareCycle(artboard, artboardName, timeline, fps, maxFrames) {
  const animation = artboard.animationByName(timeline);
  // Toutes les espèces n'exposent pas toutes les timelines : l'appelant saute.
  if (!animation) return null;

  const cycleSeconds = animation.duration / (animation.fps || 60);
  const wanted = Math.max(1, Math.round(cycleSeconds * fps));
  const frameCount = Math.min(maxFrames, wanted);

  // Le plafond ne tronque pas l'animation (la boucle reste complète), il en
  // abaisse le fps — donc en silence. On le signale : c'est le symptôme d'un
  // plafond à relever, pas d'un rendu à accepter tel quel.
  if (frameCount < wanted) {
    logger.warn(
      { artboard: artboardName, timeline, wantedFps: fps, actualFps: frameCount / cycleSeconds },
      "Animation frame cap reached, sampling below the requested frame rate"
    );
  }

  return { animation, cycleSeconds, frameCount, dt: cycleSeconds / frameCount };
}

/**
 * Repère un cycle sans le rendre : cadrage et empreinte, rien de plus.
 *
 * C'est ce qui permet à l'export de décider s'il a quelque chose à refaire
 * **avant** de payer le rendu final et l'encodage. Le résultat se repasse tel
 * quel à `renderArtboardAnimation` via l'option `probe`, pour ne pas repérer
 * deux fois.
 *
 * @returns {Promise<object|null>} `{ fingerprint, left, right, top, bottom, … }`
 */
export async function probeArtboardAnimation(
  file,
  artboardName,
  {
    stateMachineName = null,
    timeline,
    bools = null,
    settleSeconds = 0,
    fps = 15,
    maxFrames = MAX_FRAMES,
  } = {}
) {
  const rive = await getRive();

  const artboard = file.artboardByName(artboardName);
  if (!artboard) return null;

  const cycle = prepareCycle(artboard, artboardName, timeline, fps, maxFrames);
  if (!cycle) return null;

  const probe = probeCycle(
    rive,
    artboard,
    artboard.bounds,
    stateMachineName,
    bools,
    settleSeconds,
    cycle.animation,
    cycle.frameCount,
    cycle.dt
  );
  if (!probe) return null;

  return { ...probe, ...cycle };
}

export async function renderArtboardAnimation(
  file,
  artboardName,
  {
    stateMachineName = null,
    timeline,
    bools = null,
    settleSeconds = 0,
    fps = 15,
    height: targetHeight = 256,
    maxFrames = MAX_FRAMES,
    probe: precomputed = null,
  } = {}
) {
  const rive = await getRive();

  const artboard = file.artboardByName(artboardName);
  if (!artboard) return null;

  const cycle = prepareCycle(artboard, artboardName, timeline, fps, maxFrames);
  if (!cycle) return null;

  const bounds = artboard.bounds;
  const artboardWidth = bounds.maxX - bounds.minX;
  const artboardHeight = bounds.maxY - bounds.minY;
  const { cycleSeconds, frameCount, dt, animation } = cycle;

  const probe =
    precomputed ??
    probeCycle(
      rive,
      artboard,
      bounds,
      stateMachineName,
      bools,
      settleSeconds,
      animation,
      frameCount,
      dt
    );
  if (!probe) return null;

  // Hauteur de rendu telle que le sujet fasse `targetHeight` : c'est ce qui
  // rend les animations comparables entre espèces (un escargot et un cheval
  // sortent à la même taille apparente), et ce qui évite de rasteriser
  // beaucoup de vide.
  const renderHeight = Math.max(
    MIN_RENDER_HEIGHT,
    Math.min(MAX_RENDER_HEIGHT, Math.round(targetHeight / (probe.bottom - probe.top)))
  );
  const renderWidth = Math.max(1, Math.round((renderHeight * artboardWidth) / artboardHeight));

  const top = Math.max(0, Math.floor(probe.top * renderHeight));
  const bottom = Math.min(renderHeight, Math.ceil(probe.bottom * renderHeight));
  const cropHeight = Math.max(1, bottom - top);

  // Cadrage horizontal du jeu : symétrique autour de l'axe de l'artboard, pour
  // qu'une queue ou une aile qui dépasse d'un seul côté ne décale pas le sujet.
  const centerX = renderWidth / 2;
  const half = Math.max(
    centerX - probe.left * renderWidth,
    probe.right * renderWidth - centerX
  );
  const left = Math.max(0, Math.round(centerX - half));
  const cropWidth = Math.min(renderWidth - left, Math.max(1, Math.round(2 * half)));

  const canvas = makeShimmedCanvas(renderWidth, renderHeight);
  const context = canvas.getContext("2d");
  const renderer = rive.makeRenderer(canvas);
  const machine = instantiateMachine(rive, artboard, stateMachineName, bools, settleSeconds);

  // Les frames sont découpées à la volée dans une bande verticale : c'est le
  // format d'entrée de sharp pour un multi-pages, et ça évite de garder tout le
  // cycle en pleine résolution en mémoire.
  const strip = Buffer.alloc(cropWidth * cropHeight * frameCount * 4);
  const rowBytes = cropWidth * 4;
  let offset = 0;
  let opaquePixels = 0;

  try {
    playCycle(rive, artboard, machine, animation, frameCount, dt, () => {
      drawTo(rive, artboard, renderer, bounds, renderWidth, renderHeight);

      const { data } = context.getImageData(left, top, cropWidth, cropHeight);
      data.copy
        ? data.copy(strip, offset)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(strip, offset);

      for (let i = 3; i < data.length; i += 4) {
        if (data[i] >= ALPHA_THRESHOLD) opaquePixels++;
      }

      offset += rowBytes * cropHeight;
    });
  } finally {
    // null quand l'artboard n'a pas de state machine (les décors).
    machine?.delete?.();
    renderer.delete?.();
  }

  // Un cycle entièrement transparent veut dire que le rendu a échoué en
  // silence : mieux vaut ne rien écrire que servir une animation vide.
  if (opaquePixels === 0) return null;

  return {
    strip,
    width: cropWidth,
    height: cropHeight,
    frames: frameCount,
    fingerprint: probe.fingerprint,
    delays: frameDelays(cycleSeconds, frameCount),
    durationMs: Math.round(cycleSeconds * 1000),
    fps: Number((frameCount / cycleSeconds).toFixed(2)),
    // Même convention que les PNG : x = 0,5 par construction (c'est l'intérêt
    // de la symétrie), y place le sol de l'artboard sous les pattes.
    anchor: {
      x: 0.5,
      y: Math.min(1, (renderHeight - top) / cropHeight),
    },
  };
}

/**
 * Encode une capture en image animée.
 *
 * WebP est le format de référence ici : alpha 8 bits (les sprites ont des
 * bords adoucis et des ombres translucides) et bien plus compact que le GIF à
 * qualité comparable. Le GIF reste proposé pour les clients qui n'acceptent
 * que lui, au prix d'une palette de 256 couleurs et d'une transparence binaire.
 *
 * **En WebP on encode en near-lossless, pas en lossy.** Ces sprites sont du
 * vectoriel : de grands aplats et des contours nets, exactement ce que le lossy
 * traite le plus mal. Mesuré sur l'idle du Chicken, erreur par rapport au rendu
 * source (moyenne / maximum sur 255) :
 *
 * | réglage | poids | err. moy. | err. max |
 * |---|---|---|---|
 * | lossy q75 (4:2:0) | 971 Ko | 3,10 | **85** |
 * | lossy q90, chroma pleine | 1 558 Ko | 1,78 | 72 |
 * | lossy q95, chroma pleine | 1 904 Ko | 1,51 | 63 |
 * | **near-lossless q20** | **1 545 Ko** | **0,55** | **8** |
 * | lossless | 2 137 Ko | 0 | 0 |
 *
 * Le lossy ne rattrape jamais : à poids égal (~1,9 Mo) il reste dix fois plus
 * faux que le near-lossless. Visuellement, son erreur max se voit comme du
 * ringing sur les contours et une bavure des couleurs saturées sur les aplats
 * clairs — le bec orange qui déteint sur le plumage crème.
 *
 * `effort` reste à 4 : monter à 6 ne gagne que 3 % de poids pour 57 % de temps
 * d'encodage en plus.
 *
 * @param {object} capture - Retour de renderArtboardAnimation
 * @param {"webp"|"gif"} format
 * @param {object} options
 * @param {number} options.quality - Niveau de near-lossless (1-100, plus bas = plus compact)
 * @returns {Promise<Buffer>}
 */
export async function encodeAnimation(
  capture,
  format,
  { quality = config.animations.quality, colours = 128 } = {}
) {
  const image = sharp(capture.strip, {
    raw: {
      width: capture.width,
      height: capture.height * capture.frames,
      channels: 4,
      pageHeight: capture.height,
    },
  });

  if (format === "gif") {
    return image.gif({ loop: 0, delay: capture.delays, colours, dither: 0.7 }).toBuffer();
  }

  if (format === "webp") {
    return image
      .webp({ loop: 0, delay: capture.delays, nearLossless: true, quality, effort: 4 })
      .toBuffer();
  }

  throw new Error(`Unsupported animation format: ${format}`);
}
