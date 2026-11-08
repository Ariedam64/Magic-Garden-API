// tests/cosmetic-images.test.js
//
// Images des cosmétiques d'avatar (v1973+).
//
// Le bundle `cosmetic` ne garde plus que les bannières en PNG : les tenues
// (Top, Mid, Bottom, Expression…) sont passées dans `compressed-art`, en KTX2.
// /assets/cosmetics n'en listait donc plus que 9, l'Explorer n'affichait que
// les bannières, et /data/avatar-cosmetics avait `url: null` partout.
//
// Usage: node --test tests/cosmetic-images.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";

import { getCosmeticsPayload, renderCosmeticPng } from "../src/assets/cosmetics/cosmetics.js";
import { config } from "../src/config/index.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/bc7-blocks.json", import.meta.url), "utf8"));
const BLOCK = FIXTURE.blocks.find((b) => b.mode === 6);

/** KTX2 BC7 de 4x4 : un seul bloc, dont Pillow donne les texels. */
function bc7Ktx2(blockHex) {
  const data = Buffer.from(blockHex, "hex");
  const buf = Buffer.alloc(104 + data.length);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32LE(146, 12); // VK_FORMAT_BC7_SRGB_BLOCK
  buf.writeUInt32LE(1, 16);
  buf.writeUInt32LE(4, 20);
  buf.writeUInt32LE(4, 24);
  buf.writeUInt32LE(1, 36);
  buf.writeUInt32LE(1, 40);
  buf.writeBigUInt64LE(104n, 80);
  buf.writeBigUInt64LE(BigInt(data.length), 88);
  buf.writeBigUInt64LE(BigInt(data.length), 96);
  data.copy(buf, 104);
  return buf;
}

// Réduit du live 1973 (manifest.bc7.json).
const baseUrl = "https://offline.test/version/1973/assets/";
const KTX2_SRC = "/runtime-assets/Top_Haunt.bc7.2e00300ab6da229ee5f8.ktx2";
const manifest = {
  bundles: [
    { name: "cosmetic", assets: [{ alias: ["cosmetic/Banner_Fire.png"], src: [{ src: "cosmetic/Banner_Fire.png", progressSize: 4.67 }] }] },
    {
      name: "compressed-art",
      assets: [
        { alias: ["compressed-art/cosmetic/Top_Haunt"], src: [{ src: KTX2_SRC, progressSize: 40.6 }] },
        { alias: ["compressed-art/cosmetic/Mid_Skull"], src: [{ src: "/runtime-assets/Mid_Skull.bc7.0123456789abcdef0123.ktx2", progressSize: 40.6 }] },
        { alias: ["compressed-art/pet-cosmetic/Wizard"], src: [{ src: "/runtime-assets/Wizard.bc7.088785615e045ad541ad.ktx2", progressSize: 12.1 }] },
      ],
    },
  ],
};

describe("avatar cosmetics served as KTX2 (v1973)", () => {
  const realFetch = globalThis.fetch;
  const requested = [];

  before(() => {
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      if (String(url) === baseUrl + "manifest.bc7.json") return new Response(JSON.stringify(manifest));
      if (String(url) === new URL(KTX2_SRC, baseUrl).toString()) return new Response(bc7Ktx2(BLOCK.block));
      return new Response("Not Found", { status: 404 });
    };
  });
  after(() => {
    globalThis.fetch = realFetch;
  });

  it("lists the outfits of `compressed-art` next to the PNG banners", async () => {
    const { categories, count } = await getCosmeticsPayload({ baseUrl });
    assert.equal(count, 3);
    assert.deepEqual(categories.map((c) => c.cat), ["Banner", "Top", "Mid"]);
    assert.deepEqual(categories[1].items.map((i) => i.id), ["Top_Haunt"]);
  });

  it("leaves pet cosmetics to the sprite atlases", async () => {
    const { categories } = await getCosmeticsPayload({ baseUrl });
    assert.ok(!categories.some((c) => c.items.some((i) => i.name === "Wizard")));
  });

  it("points outfits at the API's PNG, versioned by the KTX2 hash", async () => {
    const { categories } = await getCosmeticsPayload({ baseUrl });
    const root = String(config.sprites.baseUrl).replace(/\/$/, "");
    assert.equal(categories[1].items[0].url, `${root}/assets/cosmetics/Top_Haunt.png?v=2e00300ab6da229ee5f8`);
    // Les bannières restent servies par le jeu.
    assert.equal(categories[0].items[0].url, baseUrl + "cosmetic/Banner_Fire.png");
  });

  it("decodes the KTX2 into a PNG with the same texels", async () => {
    const png = await renderCosmeticPng("Top_Haunt", { baseUrl });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 4);
    assert.equal(info.height, 4);
    assert.equal(info.channels, 4);
    assert.equal(data.toString("hex"), BLOCK.rgba);
  });

  it("answers null for a cosmetic it does not serve as KTX2", async () => {
    assert.equal(await renderCosmeticPng("Banner_Fire", { baseUrl }), null);
    assert.equal(await renderCosmeticPng("Top_DoesNotExist", { baseUrl }), null);
  });
});
