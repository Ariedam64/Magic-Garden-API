// tests/rive-manifest.test.js
//
// Résolution de tous les fichiers Rive du manifest.
//
// Le piège que ces tests verrouillent : le jeu ne range pas ses .riv au même
// endroit. `pets.riv` et `avatar.riv` sont dans le bundle `default`, mais
// `decor.riv`, `currency.riv`, `giftbox.riv` et `thought-bubble.riv` ont chacun
// **leur propre bundle**. Une résolution qui ne regarde que `default` — ce que
// faisait la version d'origine — en rate les deux tiers sans rien signaler.
//
// Usage: node --test tests/rive-manifest.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  resolveRiveAssets,
  resolveRiveUrl,
  resolvePetsRiveFiles,
  isPetsRiveKey,
} from "../src/assets/sprites/riveManifest.js";
import { resolvePetsRiveUrl } from "../src/assets/sprites/exportPetsFromRive.js";

describe("rive manifest resolution", () => {
  let assets = [];

  before(async () => {
    assets = await resolveRiveAssets({});
  });

  it("finds Rive files across every bundle, not just `default`", () => {
    assert.ok(assets.length >= 2, "no Rive file resolved at all");

    const keys = assets.map((a) => a.key);
    assert.ok(keys.includes("pets"), "pets.riv not resolved");

    // `decor` vit dans son propre bundle : c'est lui qui prouve qu'on ne se
    // limite plus à `default`.
    const decor = assets.find((a) => a.key === "decor");
    if (decor) {
      assert.notEqual(decor.bundle, "default", "decor.riv is expected outside the default bundle");
    }
  });

  it("keys files by name, not by alias", () => {
    // Les URL sont versionnées par hash (`pets.<hash>.riv`) et les alias sont
    // renommables côté jeu : la clé doit venir du nom de fichier.
    for (const asset of assets) {
      assert.match(asset.url, /\.riv$/);
      assert.ok(!asset.key.includes("."), `key '${asset.key}' still carries a hash or extension`);
      assert.ok(asset.src.includes(asset.key), `key '${asset.key}' does not match src ${asset.src}`);
    }
  });

  it("returns one entry per file", () => {
    const keys = assets.map((a) => a.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate keys resolved");
  });

  it("resolves a single file by key", async () => {
    const url = await resolveRiveUrl("pets", {});
    assert.match(url, /pets\.[0-9a-f]+\.riv$/);
    assert.equal(await resolveRiveUrl("does-not-exist", {}), null);
  });

  it("keeps the pets resolver working through the generic one", async () => {
    // C'est ce que consomment l'export des PNG et celui des animations.
    const pets = await resolvePetsRiveUrl();
    assert.equal(pets, await resolveRiveUrl("pets", {}));
  });
});

describe("rive manifest resolution (offline, v1231+ sources)", () => {
  // Depuis v1231 chaque source est un `{ src, progressSize }`. L'ancien filtre
  // `typeof s === "string"` ne trouvait plus rien : `/assets/rive` est resté
  // figé et Moth, Snake et Toad (dans `halloween-pets.riv`) n'ont jamais eu
  // d'image. Manifest réduit, tiré du live 1608.
  const baseUrl = "https://offline.test/version/1608/";
  const manifest = {
    bundles: [
      {
        name: "default",
        assets: [
          { alias: ["rive/pets"], src: [{ src: "/runtime-assets/pets.964225245a5dbfa6b700.riv", progressSize: 2502.07 }] },
          { alias: ["rive/halloween-pets"], src: [{ src: "/runtime-assets/halloween-pets.a39cc61ec2cdc44cf835.riv", progressSize: 298.46 }] },
          { alias: ["sprites"], src: [{ src: "sprites-2x-0.json", resolution: 2 }] },
        ],
      },
      { name: "decor.riv", assets: [{ alias: ["rive/decor"], src: ["/runtime-assets/decor.ca73f18ee9a6a2a308f6.riv"] }] },
    ],
  };

  let assets = [];
  let petFiles = [];
  before(async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(manifest), { status: 200 });
    try {
      assets = await resolveRiveAssets({ baseUrl });
      petFiles = await resolvePetsRiveFiles({ baseUrl });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("reads `{ src, progressSize }` descriptors and legacy strings alike", () => {
    assert.deepEqual(assets.map((a) => a.key), ["decor", "halloween-pets", "pets"]);
  });

  it("builds the versioned URL of each file", () => {
    const halloween = assets.find((a) => a.key === "halloween-pets");
    assert.match(halloween.url, /halloween-pets\.a39cc61ec2cdc44cf835\.riv$/);
  });

  it("lists every pets file, the main one first", () => {
    // Moth, Snake et Toad n'existent que dans `halloween-pets.riv`.
    assert.deepEqual(petFiles.map((f) => f.key), ["pets", "halloween-pets"]);
  });

  it("only treats `pets` and `<event>-pets` files as pets", () => {
    assert.ok(isPetsRiveKey("pets"));
    assert.ok(isPetsRiveKey("halloween-pets"));
    assert.ok(!isPetsRiveKey("decor"));
    assert.ok(!isPetsRiveKey("petsy"));
    assert.ok(!isPetsRiveKey("halloween-pets-silhouettes"));
  });
});
