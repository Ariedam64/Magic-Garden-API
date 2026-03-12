// tests/ktx2-sprites.test.js
//
// Integration tests for the KTX2 sprite pipeline.
// Verifies that KTX2 atlas images from the game can be decoded and cropped correctly.
//
// Usage: node --test tests/ktx2-sprites.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { decodeKTX2, isKTX2 } from "../src/assets/ktx2Decoder.js";

const GAME_BASE_URL = "https://magicgarden.gg/version/115/assets/";
const FETCH_TIMEOUT = 30_000;

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

// ─── isKTX2 helper ───────────────────────────────────────────────────

describe("isKTX2", () => {
  it("returns true for .ktx2 paths", () => {
    assert.equal(isKTX2("atlases/sprites-0.ktx2"), true);
    assert.equal(isKTX2("https://example.com/file.KTX2"), true);
  });

  it("returns false for non-ktx2 paths", () => {
    assert.equal(isKTX2("atlases/sprites-0.webp"), false);
    assert.equal(isKTX2("atlases/sprites-0.png"), false);
    assert.equal(isKTX2("atlases/sprites-0.json"), false);
  });

  it("returns false for non-string inputs", () => {
    assert.equal(isKTX2(null), false);
    assert.equal(isKTX2(undefined), false);
    assert.equal(isKTX2(123), false);
  });
});

// ─── Manifest format ─────────────────────────────────────────────────

describe("manifest format (v115+)", { timeout: FETCH_TIMEOUT * 2 }, () => {
  let manifest;

  before(async () => {
    manifest = await fetchJson(GAME_BASE_URL + "manifest.json");
  });

  it("has a default bundle", () => {
    const bundle = manifest.bundles.find((b) => b.name === "default");
    assert.ok(bundle, "default bundle must exist");
  });

  it("default bundle references .ktx2 atlas images", () => {
    const bundle = manifest.bundles.find((b) => b.name === "default");
    const ktx2Assets = bundle.assets.filter((a) =>
      a.src?.some((s) => typeof s === "string" && s.endsWith(".ktx2"))
    );
    assert.ok(ktx2Assets.length > 0, "must have at least one .ktx2 asset");
  });

  it("default bundle still has .json atlas metadata", () => {
    const bundle = manifest.bundles.find((b) => b.name === "default");
    const jsonAssets = bundle.assets.filter((a) =>
      a.src?.some(
        (s) => typeof s === "string" && s.endsWith(".json") && s !== "manifest.json"
      )
    );
    assert.ok(jsonAssets.length > 0, "must have atlas JSON files");
  });

  it("atlas JSONs reference .ktx2 in meta.image", async () => {
    const atlas = await fetchJson(GAME_BASE_URL + "atlases/sprites-0.json");
    assert.ok(atlas.meta?.image?.endsWith(".ktx2"), `meta.image should be ktx2, got: ${atlas.meta?.image}`);
  });
});

// ─── KTX2 decoding ──────────────────────────────────────────────────

describe("decodeKTX2", { timeout: FETCH_TIMEOUT * 3 }, () => {
  let weatherKtx2;

  before(async () => {
    weatherKtx2 = await fetchBuffer(GAME_BASE_URL + "atlases/weather.ktx2");
  });

  it("decodes a KTX2 file to RGBA with correct dimensions", async () => {
    const result = await decodeKTX2(weatherKtx2);

    assert.ok(result.width > 0, "width must be positive");
    assert.ok(result.height > 0, "height must be positive");
    assert.ok(Buffer.isBuffer(result.rgba), "rgba must be a Buffer");
    assert.equal(
      result.rgba.byteLength,
      result.width * result.height * 4,
      "RGBA buffer size must match width * height * 4"
    );
  });

  it("decoded RGBA contains actual pixel data (not all zeros)", async () => {
    const result = await decodeKTX2(weatherKtx2);
    const nonZero = result.rgba.some((byte) => byte > 0);
    assert.ok(nonZero, "RGBA data must contain non-zero pixels");
  });

  it("rejects invalid KTX2 data", async () => {
    const garbage = Buffer.from("not a real ktx2 file");
    await assert.rejects(() => decodeKTX2(garbage), /KTX2/);
  });

  it("accepts Uint8Array input", async () => {
    const uint8 = new Uint8Array(weatherKtx2);
    const result = await decodeKTX2(uint8);
    assert.ok(result.width > 0);
    assert.ok(result.rgba.byteLength > 0);
  });
});

// ─── Full sprite crop pipeline ───────────────────────────────────────

describe("sprite crop from KTX2 atlas", { timeout: FETCH_TIMEOUT * 3 }, () => {
  let atlasJson;
  let decoded;

  before(async () => {
    atlasJson = await fetchJson(GAME_BASE_URL + "atlases/weather.json");
    const ktx2Buf = await fetchBuffer(GAME_BASE_URL + "atlases/weather.ktx2");
    decoded = await decodeKTX2(ktx2Buf);
  });

  it("atlas JSON has frames", () => {
    const frameKeys = Object.keys(atlasJson.frames || {});
    assert.ok(frameKeys.length > 0, "atlas must have frames");
  });

  it("can crop a single frame from decoded RGBA atlas", async () => {
    const frameKeys = Object.keys(atlasJson.frames);
    const firstKey = frameKeys[0];
    const frameData = atlasJson.frames[firstKey];
    const frame = frameData.frame;

    assert.ok(frame, `frame data must exist for ${firstKey}`);

    const cropW = frameData.rotated ? frame.h : frame.w;
    const cropH = frameData.rotated ? frame.w : frame.h;

    const cropped = await sharp(decoded.rgba, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .extract({ left: frame.x, top: frame.y, width: cropW, height: cropH })
      .png()
      .toBuffer();

    assert.ok(cropped.byteLength > 0, "cropped PNG must have data");

    const metadata = await sharp(cropped).metadata();
    const expectedW = frameData.rotated ? frame.h : frame.w;
    const expectedH = frameData.rotated ? frame.w : frame.h;
    assert.equal(metadata.width, expectedW, "cropped width must match frame");
    assert.equal(metadata.height, expectedH, "cropped height must match frame");
  });

  it("can crop multiple frames without errors", async () => {
    const frameKeys = Object.keys(atlasJson.frames).slice(0, 5);
    const sharpInput = decoded.rgba;
    const sharpOptions = { raw: { width: decoded.width, height: decoded.height, channels: 4 } };

    for (const key of frameKeys) {
      const frameData = atlasJson.frames[key];
      const frame = frameData.frame;
      const cropW = frameData.rotated ? frame.h : frame.w;
      const cropH = frameData.rotated ? frame.w : frame.h;

      const buf = await sharp(sharpInput, sharpOptions)
        .extract({ left: frame.x, top: frame.y, width: cropW, height: cropH })
        .png()
        .toBuffer();

      assert.ok(buf.byteLength > 0, `crop of ${key} must produce data`);
    }
  });

  it("handles rotated frames correctly (w/h swap + rotate 270)", async () => {
    const rotatedEntry = Object.entries(atlasJson.frames).find(
      ([, data]) => data.rotated
    );

    if (!rotatedEntry) {
      // Skip if no rotated frames in weather atlas
      return;
    }

    const [key, frameData] = rotatedEntry;
    const frame = frameData.frame;

    // Rotated: crop w/h swapped, then rotate 270
    const cropped = await sharp(decoded.rgba, {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
      .extract({ left: frame.x, top: frame.y, width: frame.h, height: frame.w })
      .rotate(270)
      .png()
      .toBuffer();

    const metadata = await sharp(cropped).metadata();
    assert.equal(metadata.width, frame.w, `rotated frame ${key} width after rotation`);
    assert.equal(metadata.height, frame.h, `rotated frame ${key} height after rotation`);
  });
});

// ─── sprites-0 atlas (largest, verifies big texture support) ─────────

describe("sprites-0 atlas decode", { timeout: FETCH_TIMEOUT * 4 }, () => {
  it("decodes the largest atlas (4096px) correctly", async () => {
    const ktx2Buf = await fetchBuffer(GAME_BASE_URL + "atlases/sprites-0.ktx2");
    const result = await decodeKTX2(ktx2Buf);

    assert.equal(result.width, 4096, "sprites-0 width should be 4096");
    assert.ok(result.height > 4000, "sprites-0 height should be > 4000");
    assert.equal(result.rgba.byteLength, result.width * result.height * 4);
  });
});
