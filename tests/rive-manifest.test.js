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
  findContainerArtboard,
} from "../src/assets/sprites/riveManifest.js";
import { resolvePetsRiveUrls } from "../src/assets/sprites/exportPetsFromRive.js";

describe("rive manifest resolution", () => {
  let assets = [];

  before(async () => {
    assets = await resolveRiveAssets({});
  });

  it("finds Rive files across every bundle, not just `default`", async () => {
    assert.ok(assets.length >= 2, "no Rive file resolved at all");

    // Un `pets.riv` jusqu'à la v1970, un fichier par espèce depuis.
    const pets = await resolvePetsRiveFiles({});
    assert.ok(pets.length > 0, "no pets .riv resolved");

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
    const url = await resolveRiveUrl("decor", {});
    assert.match(url, /decor\.[0-9a-f]+\.riv$/);
    assert.equal(await resolveRiveUrl("does-not-exist", {}), null);
  });

  it("keeps the pets resolver working through the generic one", async () => {
    // C'est ce que consomment l'export des PNG et celui des animations.
    const urls = await resolvePetsRiveUrls();
    assert.deepEqual(urls, (await resolvePetsRiveFiles({})).map((f) => f.url));
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

describe("rive manifest resolution (offline, one file per pet, v1973)", () => {
  // Le jeu a éclaté `pets.riv` : chaque espèce a son fichier, chargé par
  // `riveFileSrc: rive/pets/<Espèce>, artboardName: <Espèce>`, dans le bundle
  // `pets`. Leur clé est le nom de l'espèce, que `isPetsRiveKey` ne reconnaît
  // pas : la sync n'en voyait aucun et gardait les rendus de l'ancien fichier.
  // Manifest réduit, tiré du live 1973 (manifest.bc7.json).
  const baseUrl = "https://offline.test/version/1973/";
  const manifest = {
    bundles: [
      { name: "default", assets: [{ alias: ["atlases/sprites-0.json"], src: [{ src: "atlases/sprites-0.bc7.json", progressSize: 7878.38 }] }] },
      { name: "decor.riv", assets: [{ alias: ["rive/decor.riv", "rive/decor"], src: [{ src: "/runtime-assets/decor.ca73f18ee9a6a2a308f6.riv", progressSize: 288.99 }] }] },
      { name: "emotes.riv", assets: [{ alias: ["rive/emotes.riv", "rive/emotes"], src: [{ src: "/runtime-assets/emotes.8f92061cc40bd4a715c3.riv", progressSize: 323.01 }] }] },
      {
        name: "pets",
        assets: [
          { alias: ["rive/pets/Bat.riv", "rive/pets/Bat"], src: [{ src: "/runtime-assets/Bat.5f9a3582f478d1f4040e.riv", progressSize: 87.16 }] },
          { alias: ["rive/pets/Bee.riv", "rive/pets/Bee"], src: [{ src: "/runtime-assets/Bee.51e6941abdbf7faac7d0.riv", progressSize: 77.36 }] },
        ],
      },
    ],
  };

  let petFiles = [];
  before(async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(manifest), { status: 200 });
    try {
      petFiles = await resolvePetsRiveFiles({ baseUrl });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("lists each per-species file as a pets file", () => {
    assert.deepEqual(petFiles.map((f) => f.key), ["Bat", "Bee"]);
    assert.match(petFiles[0].url, /Bat\.5f9a3582f478d1f4040e\.riv$/);
  });

  it("does not take emotes or decor for pets", () => {
    assert.ok(!petFiles.some((f) => f.key === "emotes" || f.key === "decor"));
  });
});

describe("findContainerArtboard", () => {
  it("still skips the `Pets` container of a multi-species file", () => {
    assert.equal(findContainerArtboard(["Pets", "Bat", "Bee"], "pets"), "Pets");
  });

  it("keeps the only artboard of a file named after it", () => {
    // `Bat.riv` n'a qu'un artboard, `Bat` : c'est le pet, pas un conteneur.
    // L'exclure vidait l'inventaire de chaque pet, et d'`emotes.riv`.
    assert.equal(findContainerArtboard(["Bat"], "Bat"), null);
    assert.equal(findContainerArtboard(["Emotes"], "emotes"), null);
  });

  it("excludes nothing when no artboard is named after the file", () => {
    assert.equal(findContainerArtboard(["WoodWindmill", "StoneTorch"], "decor"), null);
  });
});
