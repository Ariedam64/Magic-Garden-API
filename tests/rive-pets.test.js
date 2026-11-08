// tests/rive-pets.test.js
//
// Integration tests for the Rive pet sprite pipeline.
//
// Le jeu a sorti les pets des atlas TexturePacker : `sprite/pet/*` ne contient
// plus que les œufs, et chaque créature est un artboard Rive. Depuis la v1973,
// chaque espèce a son propre fichier (`rive/pets/Bat` -> `Bat.riv`).
// Ces tests vérifient qu'on retrouve bien les .riv dans le manifest live et
// qu'on sait en rasteriser un artboard.
//
// Usage: node --test tests/rive-pets.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { loadRiveFile, renderArtboardToPng } from "../src/assets/sprites/riveRenderer.js";
import { loadPetRiveFiles } from "./petRiveFiles.js";

const PET_STATE_MACHINE = "Pet State Machine";

// Espèces présentes depuis longtemps : si l'une disparaît des artboards, c'est
// que le format a encore bougé et que l'export doit être revu.
const EXPECTED_PETS = ["Bat", "Chicken", "Horse", "ThunderWolf"];

describe("pets Rive asset", () => {
  let pets = new Map();
  const petFile = (name) => pets.get(name) ?? null;

  before(async () => {
    pets = await loadPetRiveFiles();
  });

  it("is listed in the live manifest", () => {
    assert.ok(pets.size > 0, "no pets .riv found in manifest");
  });

  it("exposes one artboard per pet species", () => {
    for (const pet of EXPECTED_PETS) {
      assert.ok(pets.has(pet), `missing artboard: ${pet}`);
    }
  });

  it("renders an artboard to a non-empty PNG", async () => {
    const rendered = await renderArtboardToPng(petFile("Chicken"), "Chicken", {
      stateMachineName: PET_STATE_MACHINE,
    });

    assert.ok(rendered, "render returned nothing");
    assert.ok(rendered.width > 0 && rendered.height > 0);

    const { info } = await sharp(rendered.buffer)
      .trim({ threshold: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });

    // Un canvas resté transparent se rogne jusqu'à disparaître : c'est le
    // symptôme d'une frame Rive non validée (cf. resolveAnimationFrame).
    assert.ok(info.width > 1 && info.height > 1, "rendered sprite is empty");
  });

  it("centres every pet on the artboard axis, like the game does", async () => {
    // Le cadrage du jeu symétrise autour de l'axe de l'artboard (doc-rive.md
    // §3), donc l'ancre horizontale vaut 0.5 par construction. Un rognage
    // serré des deux côtés la ferait dériver dès qu'une queue dépasse.
    for (const pet of EXPECTED_PETS) {
      const rendered = await renderArtboardToPng(petFile(pet), pet, {
        stateMachineName: PET_STATE_MACHINE,
      });

      assert.equal(rendered.anchor.x, 0.5, `${pet} is not centred`);
      assert.equal(rendered.width % 1, 0);
      assert.ok(rendered.height > 1, `${pet} rendered empty`);
    }
  });

  it("keeps flying pets wider than tall", async () => {
    // Garde-fou de pose : ailes repliées, la chauve-souris devient plus haute
    // que large. La frame d'atlas d'origine faisait 312x157.
    const rendered = await renderArtboardToPng(petFile("Bat"), "Bat", {
      stateMachineName: PET_STATE_MACHINE,
    });

    assert.ok(
      rendered.width > rendered.height * 1.2,
      `Bat should be wider than tall, got ${rendered.width}x${rendered.height}`
    );
  });

  it("renders the weather-active variant differently from the base pose", async () => {
    const base = await renderArtboardToPng(petFile("ThunderWolf"), "ThunderWolf", {
      stateMachineName: PET_STATE_MACHINE,
    });
    const active = await renderArtboardToPng(petFile("ThunderWolf"), "ThunderWolf", {
      stateMachineName: PET_STATE_MACHINE,
      inputs: { thunder: true },
      pose: "widest",
      settleSeconds: 4,
    });

    assert.ok(base && active);
    assert.notEqual(
      base.buffer.toString("base64"),
      active.buffer.toString("base64"),
      "the `thunder` state machine input had no visible effect"
    );
  });

  it("fails loudly when the state machine is renamed", async () => {
    // Sans state machine l'artboard rend sa pose d'édition — un PNG valide,
    // mais avec l'ombre au sol et le pet à la mauvaise échelle. Un renommage
    // côté jeu corromprait les 28 sprites en silence.
    await assert.rejects(
      () =>
        renderArtboardToPng(petFile("Peacock"), "Peacock", {
          stateMachineName: "Pet State Machine RENAMED",
        }),
      /State machine .* not found/
    );
  });

  it("bounds a Rive file it cannot read instead of hanging", async () => {
    // `rive.load()` ne rejette pas sur un format inconnu, il ne résout jamais.
    // Non borné, ça fait tomber la sync dans son timeout, qui tue le process.
    const notRive = Buffer.concat([Buffer.from("RIVE"), Buffer.alloc(4096, 7)]);

    await assert.rejects(
      () => loadRiveFile(notRive, { timeoutMs: 3000 }),
      (err) => /timed out|no file|Rive/i.test(err.message)
    );
  });

  it("no longer finds pet creatures in the sprite atlases", async () => {
    // Garde-fou : si le jeu remet les pets dans l'atlas, l'export Rive devient
    // redondant et ce test le signale.
    const { initSprites, lookupSprite } = await import("../src/assets/sprites/sprites.js");
    await initSprites();

    assert.equal(lookupSprite("sprite/pet/Chicken"), null);
    assert.ok(lookupSprite("sprite/pet/CommonEgg"), "eggs should still be in the atlas");
  });
});
