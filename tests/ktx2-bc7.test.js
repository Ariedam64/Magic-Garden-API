// tests/ktx2-bc7.test.js
//
// Atlas BC7 (v1973+).
//
// Le jeu a remplacé `manifest.json` par un manifest par format de texture GPU
// (`manifest.bc7.json`, `manifest.rgba8.json`, …) et ses atlas KTX2 ne sont
// plus en Basis : ce sont des blocs prêts pour la carte graphique, que le
// transcodeur Basis refuse. Seule la variante BC7 a une image pleine taille
// pour chaque atlas (les coordonnées des frames sont en pleine taille).
//
// Les texels attendus viennent de Pillow (décodeur BC7 de référence), un bloc
// par mode : voir tests/fixtures/bc7-blocks.json.
//
// Usage: node --test tests/ktx2-bc7.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { decodeKTX2 } from "../src/assets/ktx2Decoder.js";
import { decodeBC7 } from "../src/assets/bc7.js";
import { loadManifest, extractJsonFiles } from "../src/assets/manifest.js";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/bc7-blocks.json", import.meta.url), "utf8"));

const VK_FORMAT_R8G8B8A8_SRGB = 43;
const VK_FORMAT_BC7_SRGB_BLOCK = 146;

/** KTX2 minimal : en-tête, index (vide), un niveau. */
function buildKTX2({ vkFormat, width, height, data }) {
  const headerSize = 80 + 24; // en-tête + index d'un niveau
  const buf = Buffer.alloc(headerSize + data.length);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32LE(vkFormat, 12);
  buf.writeUInt32LE(1, 16); // typeSize
  buf.writeUInt32LE(width, 20);
  buf.writeUInt32LE(height, 24);
  buf.writeUInt32LE(0, 28); // pixelDepth
  buf.writeUInt32LE(0, 32); // layerCount
  buf.writeUInt32LE(1, 36); // faceCount
  buf.writeUInt32LE(1, 40); // levelCount
  buf.writeUInt32LE(0, 44); // supercompressionScheme
  buf.writeBigUInt64LE(BigInt(headerSize), 80);
  buf.writeBigUInt64LE(BigInt(data.length), 88);
  buf.writeBigUInt64LE(BigInt(data.length), 96);
  Buffer.from(data).copy(buf, headerSize);
  return buf;
}

describe("decodeBC7", () => {
  for (const { mode, origin, block, rgba } of FIXTURE.blocks) {
    it(`decodes a mode ${mode} block (${origin}) like the reference decoder`, () => {
      const out = decodeBC7(Buffer.from(block, "hex"), 4, 4);
      assert.equal(out.toString("hex"), rgba);
    });
  }

  it("covers all eight modes", () => {
    assert.deepEqual(FIXTURE.blocks.map((b) => b.mode).sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("lays blocks out row by row", () => {
    // 8x4 : bloc du mode 6 à gauche, du mode 5 à droite.
    const left = FIXTURE.blocks.find((b) => b.mode === 6);
    const right = FIXTURE.blocks.find((b) => b.mode === 5);
    const out = decodeBC7(Buffer.from(left.block + right.block, "hex"), 8, 4);
    const l = Buffer.from(left.rgba, "hex");
    const r = Buffer.from(right.rgba, "hex");
    for (let y = 0; y < 4; y++) {
      assert.equal(out.subarray(y * 32, y * 32 + 16).toString("hex"), l.subarray(y * 16, y * 16 + 16).toString("hex"));
      assert.equal(out.subarray(y * 32 + 16, y * 32 + 32).toString("hex"), r.subarray(y * 16, y * 16 + 16).toString("hex"));
    }
  });
});

describe("decodeKTX2 on GPU-ready textures", () => {
  it("decodes a BC7 KTX2 without the Basis transcoder", async () => {
    const block = FIXTURE.blocks.find((b) => b.mode === 6);
    const ktx2 = buildKTX2({ vkFormat: VK_FORMAT_BC7_SRGB_BLOCK, width: 4, height: 4, data: Buffer.from(block.block, "hex") });
    const { width, height, rgba } = await decodeKTX2(ktx2);
    assert.equal(width, 4);
    assert.equal(height, 4);
    assert.equal(rgba.toString("hex"), block.rgba);
  });

  it("names the format it cannot decode", async () => {
    const ktx2 = buildKTX2({ vkFormat: VK_FORMAT_R8G8B8A8_SRGB, width: 4, height: 4, data: Buffer.alloc(64) });
    await assert.rejects(decodeKTX2(ktx2), /vkFormat 43/);
  });
});

describe("loadManifest picks the per-format manifest", () => {
  async function withFetch(routes, fn) {
    const realFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      const body = routes[String(url)];
      return body
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response("Not Found", { status: 404 });
    };
    try {
      return { result: await fn(), requested };
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  it("loads manifest.bc7.json when the game no longer serves manifest.json (v1973)", async () => {
    const baseUrl = "https://test.invalid/version/1973/assets/";
    const manifest = { bundles: [{ name: "default", assets: [] }] };
    const { result } = await withFetch({ [baseUrl + "manifest.bc7.json"]: manifest }, () =>
      loadManifest({ baseUrl })
    );
    assert.deepEqual(result, manifest);
  });

  it("falls back to manifest.json for versions that still serve it", async () => {
    const baseUrl = "https://test.invalid/version/1961/assets/";
    const manifest = { bundles: [{ name: "default", assets: [] }] };
    const { result } = await withFetch({ [baseUrl + "manifest.json"]: manifest }, () =>
      loadManifest({ baseUrl })
    );
    assert.deepEqual(result, manifest);
  });

  it("still fails loudly when neither exists", async () => {
    const baseUrl = "https://test.invalid/version/1/assets/";
    await withFetch({}, () =>
      assert.rejects(loadManifest({ baseUrl }), /404/)
    );
  });

  it("does not take a manifest for an atlas", () => {
    const bundle = {
      assets: [
        { src: [{ src: "manifest.bc7.json" }] },
        { src: [{ src: "atlases/sprites-0.bc7.json" }] },
      ],
    };
    assert.deepEqual(extractJsonFiles(bundle), ["atlases/sprites-0.bc7.json"]);
  });
});
