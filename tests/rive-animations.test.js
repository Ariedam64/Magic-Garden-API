// tests/rive-animations.test.js
//
// Integration tests for the animated pet loops (WebP/GIF) rendered from
// `rive/pets.riv`.
//
// Ce que ces tests protègent, au-delà du "ça produit un fichier" : une boucle
// animée peut être parfaitement valide et pourtant inutilisable — cadre qui
// tressaute d'une frame à l'autre, durées de frames qui dérivent, ou dernière
// frame qui ne raccorde pas avec la première. Ce sont ces propriétés-là qu'on
// vérifie.
//
// Usage: node --test tests/rive-animations.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { resolvePetsRiveUrl, PET_STATE_MACHINE } from "../src/assets/sprites/exportPetsFromRive.js";
import { loadRiveFile, getRive } from "../src/assets/sprites/riveRenderer.js";
import { renderArtboardAnimation, encodeAnimation } from "../src/assets/sprites/riveAnimator.js";
import { buildAnimationUrl } from "../src/utils/spriteUrlBuilder.js";
import { buildAnimationLinks } from "../src/assets/sprites/riveAnimations.js";
import { buildRiveSource } from "../src/assets/sprites/riveSource.js";
import { resolveRiveUrl } from "../src/assets/sprites/riveManifest.js";

const FETCH_TIMEOUT = 30_000;
const TARGET_HEIGHT = 128;

describe("pet animation rendering", () => {
  let riveFile = null;

  before(async () => {
    const riveUrl = await resolvePetsRiveUrl();
    if (!riveUrl) return;

    const res = await fetch(riveUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
    });
    assert.ok(res.ok, `Rive download failed (${res.status})`);

    riveFile = (await loadRiveFile(Buffer.from(await res.arrayBuffer()))).file;
  });

  it("renders an idle cycle with a stable frame and exact timing", async () => {
    const capture = await renderArtboardAnimation(riveFile, "Chicken", {
      stateMachineName: PET_STATE_MACHINE,
      timeline: "Pet_Idle",
      fps: 10,
      height: TARGET_HEIGHT,
    });

    assert.ok(capture, "render returned nothing");
    assert.ok(capture.frames > 1, "a single frame is not an animation");
    assert.equal(capture.strip.length, capture.width * capture.height * capture.frames * 4);

    // Les delays sont des millisecondes entières : arrondir chaque frame à
    // l'identique décalerait la boucle. Leur somme doit rendre la durée exacte
    // de la timeline.
    const total = capture.delays.reduce((sum, d) => sum + d, 0);
    assert.equal(capture.delays.length, capture.frames);
    assert.equal(total, capture.durationMs);

    // Cadrage du jeu : symétrique autour de l'axe de l'artboard.
    assert.equal(capture.anchor.x, 0.5);
  });

  it("normalises subject height across species", async () => {
    // Un escargot occupe un tiers de son artboard, un cheval la quasi-totalité.
    // Sans mise à l'échelle par espèce, les boucles sortiraient à des tailles
    // apparentes sans rapport entre elles.
    const heights = [];
    for (const pet of ["Snail", "Horse", "Chicken"]) {
      const capture = await renderArtboardAnimation(riveFile, pet, {
        stateMachineName: PET_STATE_MACHINE,
        timeline: "Pet_Idle",
        fps: 4,
        height: TARGET_HEIGHT,
      });
      assert.ok(capture, `${pet} rendered nothing`);
      heights.push(capture.height);
    }

    for (const height of heights) {
      assert.ok(
        Math.abs(height - TARGET_HEIGHT) <= 8,
        `expected ~${TARGET_HEIGHT}px subjects, got ${heights.join(", ")}`
      );
    }
  });

  it("keeps the subject inside the frame for the whole cycle", async () => {
    // Le cadre est commun à toutes les frames (sinon le sujet tressaute), et
    // déduit d'une passe de repérage à basse résolution. Si cette passe ratait
    // une frame, on rognerait le pet à cet instant-là : on vérifie donc que
    // rien d'opaque ne touche le bord.
    const capture = await renderArtboardAnimation(riveFile, "Bat", {
      stateMachineName: PET_STATE_MACHINE,
      timeline: "Pet_Idle",
      fps: 12,
      height: TARGET_HEIGHT,
    });

    assert.ok(capture);

    const { width, height, frames, strip } = capture;
    for (let frame = 0; frame < frames; frame++) {
      const base = frame * width * height * 4;

      for (let x = 0; x < width; x++) {
        const top = base + x * 4 + 3;
        const bottom = base + ((height - 1) * width + x) * 4 + 3;
        assert.ok(strip[top] < 16, `frame ${frame} touches the top edge at x=${x}`);
        assert.ok(strip[bottom] < 16, `frame ${frame} touches the bottom edge at x=${x}`);
      }

      for (let y = 0; y < height; y++) {
        const left = base + y * width * 4 + 3;
        const right = base + (y * width + width - 1) * 4 + 3;
        assert.ok(strip[left] < 16, `frame ${frame} touches the left edge at y=${y}`);
        assert.ok(strip[right] < 16, `frame ${frame} touches the right edge at y=${y}`);
      }
    }
  });

  it("loops seamlessly", async () => {
    // On joue la timeline, pas la state machine, précisément pour ça : la
    // dernière frame doit raccorder avec la première.
    const capture = await renderArtboardAnimation(riveFile, "Chicken", {
      stateMachineName: PET_STATE_MACHINE,
      timeline: "Pet_Idle",
      fps: 12,
      height: TARGET_HEIGHT,
    });

    const pixels = capture.width * capture.height;
    const last = (capture.frames - 1) * pixels * 4;

    let delta = 0;
    for (let i = 0; i < pixels * 4; i += 4) {
      delta += Math.abs(capture.strip[i + 3] - capture.strip[last + i + 3]);
    }

    const meanAlphaDelta = delta / pixels;
    assert.ok(meanAlphaDelta < 4, `loop seam too visible (mean alpha delta ${meanAlphaDelta})`);
  });

  it("skips timelines a species does not have", async () => {
    const capture = await renderArtboardAnimation(riveFile, "Chicken", {
      stateMachineName: PET_STATE_MACHINE,
      timeline: "Pet_ThisTimelineDoesNotExist",
      height: TARGET_HEIGHT,
    });

    assert.equal(capture, null);
  });

  it("fails loudly when the state machine is renamed", async () => {
    // Même garde-fou que pour les PNG : sans state machine l'artboard rend sa
    // pose d'édition, qui produirait une animation valide mais fausse.
    await assert.rejects(
      () =>
        renderArtboardAnimation(riveFile, "Chicken", {
          stateMachineName: "Pet State Machine (renamed)",
          timeline: "Pet_Idle",
          height: TARGET_HEIGHT,
        }),
      /State machine .* not found/
    );
  });

  it("encodes an infinite-looping animated WebP", async () => {
    const capture = await renderArtboardAnimation(riveFile, "Chicken", {
      stateMachineName: PET_STATE_MACHINE,
      timeline: "Pet_Walk",
      fps: 12,
      height: TARGET_HEIGHT,
    });

    const buffer = await encodeAnimation(capture, "webp");
    const meta = await sharp(buffer, { pages: -1 }).metadata();

    assert.equal(meta.format, "webp");
    assert.equal(meta.pages, capture.frames);
    assert.equal(meta.pageHeight, capture.height);
    assert.equal(meta.loop, 0, "animation should loop forever");
    // Un delay par frame : sharp n'applique un scalaire qu'à la première et
    // laisse les autres à 100 ms.
    assert.deepEqual(meta.delay, capture.delays);
  });
});

describe("animation links", () => {
  it("builds URLs under /assets/animations", () => {
    assert.equal(
      buildAnimationUrl("pets", "Chicken", "idle", "webp", {
        baseUrl: "https://example.test",
      }),
      "https://example.test/assets/animations/pets/Chicken_idle.webp"
    );

    assert.equal(
      buildAnimationUrl("pets", "FireHorseActive", "idle", "gif", {
        baseUrl: "https://example.test",
        version: "824",
      }),
      "https://example.test/assets/animations/pets/FireHorseActive_idle.gif?v=824"
    );

    assert.equal(buildAnimationUrl("pets", "Chicken", "idle", null), null);
  });

  it("exposes one link per clip, without repeating it per format", () => {
    const clip = {
      width: 212,
      height: 257,
      frames: 210,
      fps: 30,
      durationMs: 7000,
      anchor: { x: 0.5, y: 1 },
      formats: { webp: { bytes: 1 }, gif: { bytes: 2 } },
    };

    const links = buildAnimationLinks("pets", "Chicken", {
      version: "824",
      animations: { Chicken: { idle: clip } },
    });

    assert.match(links.idle.url, /Chicken_idle\.webp\?v=824$/);
    assert.equal(links.idle.format, "webp");
    assert.equal(links.idle.durationMs, 7000);

    // Un format supplémentaire a sa propre clé ; le format principal n'est
    // jamais répété sous la sienne — ce serait la même URL que `url`.
    assert.match(links.idle.gif, /Chicken_idle\.gif\?v=824$/);
    assert.equal(links.idle.webp, undefined);

    const webpOnly = buildAnimationLinks("pets", "Chicken", {
      animations: { Chicken: { idle: { ...clip, formats: { webp: { bytes: 1 } } } } },
    });

    assert.deepEqual(
      Object.keys(webpOnly.idle).filter((key) => key.endsWith("url") || key === "gif"),
      ["url"]
    );
  });

  it("returns null for a species with no animation", () => {
    assert.equal(buildAnimationLinks("pets", "Chicken", { animations: {} }), null);
    assert.equal(buildAnimationLinks("pets", "Chicken", { animations: { Chicken: {} } }), null);
  });

  it("names the timeline each clip came from", () => {
    // C'est ce qui permet à un client de rejouer le même clip depuis le .riv :
    // sans ce nom, il devrait deviner que `idle` s'appelle `Pet_Idle`.
    const links = buildAnimationLinks("pets", "Chicken", {
      animations: {
        Chicken: {
          walk: { timeline: "Pet_Walk", formats: { webp: { bytes: 1 } } },
        },
      },
    });

    assert.equal(links.walk.timeline, "Pet_Walk");
  });
});

describe("rive source", () => {
  it("publishes a browser-fetchable URL, not the raw game one", () => {
    // magicgarden.gg ne renvoie aucun en-tête CORS : l'URL amont est
    // inutilisable depuis un navigateur tiers, seul le proxy l'est.
    const source = buildRiveSource("Chicken", "https://magicgarden.gg/runtime-assets/pets.abc.riv");

    assert.match(source.url, /\/assets\/proxy\?url=https%3A%2F%2Fmagicgarden\.gg/);
    assert.equal(source.origin, "https://magicgarden.gg/runtime-assets/pets.abc.riv");
    assert.equal(source.artboard, "Chicken");
    assert.equal(source.stateMachine, PET_STATE_MACHINE);
  });

  it("says nothing rather than guessing when the file is unknown", () => {
    assert.equal(buildRiveSource("Chicken", null), null);
    assert.equal(buildRiveSource(null, "https://magicgarden.gg/x.riv"), null);
  });
});

describe("decor animations", () => {
  it("derives clips from what the artboard declares, not from a hardcoded list", async () => {
    // Les noms de timelines des décors sont incohérents (`WoodWindmill_On`,
    // `WindSpinner_Spins`, `Caludron` — la faute est dans le fichier du jeu, et
    // deux `Timeline 1`). Les coder en dur casserait à la première maj.
    const riveUrl = await resolveRiveUrl("decor", {});
    if (!riveUrl) return;

    const res = await fetch(riveUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
    });
    const { file, artboardNames } = await loadRiveFile(Buffer.from(await res.arrayBuffer()));

    assert.ok(artboardNames.length >= 8, `expected 8+ decor artboards, got ${artboardNames.length}`);

    for (const name of artboardNames) {
      const artboard = file.artboardByName(name);
      assert.ok(artboard.animationCount() >= 1, `${name} has no timeline`);

      // Un décor tourne en boucle sans état : sa state machine n'a aucune
      // entrée. C'est ce qui les rend plus simples que les pets.
      if (artboard.stateMachineCount() > 0) {
        const rive = await getRive();
        const definition = artboard.stateMachineByIndex(0);
        const instance = new rive.StateMachineInstance(definition, artboard);
        assert.equal(instance.inputCount(), 0, `${name} unexpectedly exposes inputs`);
        instance.delete?.();
      }
    }
  });

  it("renders a decor loop without needing a state machine name", async () => {
    const riveUrl = await resolveRiveUrl("decor", {});
    if (!riveUrl) return;

    const res = await fetch(riveUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
    });
    const { file } = await loadRiveFile(Buffer.from(await res.arrayBuffer()));

    const capture = await renderArtboardAnimation(file, "WoodWindmill", {
      stateMachineName: null,
      timeline: "WoodWindmill_On",
      fps: 8,
      height: TARGET_HEIGHT,
    });

    assert.ok(capture, "decor render returned nothing");
    assert.ok(capture.frames > 1);
    assert.equal(capture.anchor.x, 0.5);
  });
});
