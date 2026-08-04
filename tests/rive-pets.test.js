// tests/rive-pets.test.js
//
// Integration tests for the Rive pet sprite pipeline.
//
// Le jeu a sorti les pets des atlas TexturePacker : `sprite/pet/*` ne contient
// plus que les œufs, et chaque créature est un artboard de `rive/pets.riv`.
// Ces tests vérifient qu'on retrouve bien le .riv dans le manifest live et
// qu'on sait en rasteriser un artboard.
//
// Usage: node --test tests/rive-pets.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { resolvePetsRiveUrl } from "../src/assets/sprites/exportPetsFromRive.js";
import { loadRiveFile, renderArtboardToPng } from "../src/assets/sprites/riveRenderer.js";

const FETCH_TIMEOUT = 30_000;
const PET_STATE_MACHINE = "Pet State Machine";

// Espèces présentes depuis longtemps : si l'une disparaît des artboards, c'est
// que le format a encore bougé et que l'export doit être revu.
const EXPECTED_PETS = ["Bat", "Chicken", "Horse", "ThunderWolf"];

describe("pets Rive asset", () => {
  let riveUrl = null;
  let riveFile = null;
  let artboardNames = [];

  before(async () => {
    riveUrl = await resolvePetsRiveUrl();
    if (!riveUrl) return;

    const res = await fetch(riveUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: "follow",
    });
    assert.ok(res.ok, `Rive download failed (${res.status})`);

    const loaded = await loadRiveFile(Buffer.from(await res.arrayBuffer()));
    riveFile = loaded.file;
    artboardNames = loaded.artboardNames;
  });

  it("is listed in the live manifest", () => {
    assert.ok(riveUrl, "pets .riv not found in manifest");
    assert.match(riveUrl, /\.riv$/);
  });

  it("exposes one artboard per pet species", () => {
    for (const pet of EXPECTED_PETS) {
      assert.ok(artboardNames.includes(pet), `missing artboard: ${pet}`);
    }
  });

  it("renders an artboard to a non-empty PNG", async () => {
    const rendered = await renderArtboardToPng(riveFile, "Chicken", {
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

  it("renders the weather-active variant differently from the base pose", async () => {
    const base = await renderArtboardToPng(riveFile, "ThunderWolf", {
      stateMachineName: PET_STATE_MACHINE,
    });
    const active = await renderArtboardToPng(riveFile, "ThunderWolf", {
      stateMachineName: PET_STATE_MACHINE,
      inputs: { thunder: true },
    });

    assert.ok(base && active);
    assert.notEqual(
      base.buffer.toString("base64"),
      active.buffer.toString("base64"),
      "the `thunder` state machine input had no visible effect"
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
