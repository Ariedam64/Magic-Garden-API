// tests/manifest-sources.test.js
//
// Unit tests for manifest source extraction.
// The game's manifest declares multi-resolution assets as objects
// ({ src, resolution }) instead of plain path strings, so extraction must
// handle both shapes and keep only the full-resolution variant.
//
// Usage: node --test tests/manifest-sources.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonFiles, extractAllSources, assetSourcePaths } from "../src/assets/manifest.js";

// Shape captured from https://magicgarden.gg/version/1029/assets/manifest.json
const MULTI_RESOLUTION_BUNDLE = {
  name: "default",
  assets: [
    {
      alias: ["atlases/sprites-0.json"],
      src: [
        { src: "atlases/sprites-1x-0.json", resolution: 1 },
        { src: "atlases/sprites-2x-0.json", resolution: 2 },
      ],
    },
    {
      alias: ["atlases/tiles.json"],
      src: [
        { src: "atlases/tiles-1x.json", resolution: 1 },
        { src: "atlases/tiles-2x.json", resolution: 2 },
      ],
    },
    {
      alias: ["rive/avatar.riv"],
      src: ["/runtime-assets/avatar.a37070e0f510200217b1.riv"],
    },
  ],
};

// Shape used by older game versions (plain strings).
const LEGACY_BUNDLE = {
  name: "default",
  assets: [
    { alias: ["atlases/sprites-0.json"], src: ["atlases/sprites-0.json"] },
    { alias: ["manifest"], src: ["manifest.json"] },
    { alias: ["ui/ActivityLog"], src: ["ui/ActivityLog.webp"] },
  ],
};

describe("extractJsonFiles", () => {
  it("extracts JSON atlases declared as { src, resolution } objects", () => {
    const files = extractJsonFiles(MULTI_RESOLUTION_BUNDLE);
    assert.ok(files.length > 0, "no JSON atlas extracted from multi-resolution bundle");
  });

  it("keeps only the highest-resolution variant of each asset", () => {
    const files = extractJsonFiles(MULTI_RESOLUTION_BUNDLE);
    assert.deepEqual(files, ["atlases/sprites-2x-0.json", "atlases/tiles-2x.json"]);
  });

  it("still supports legacy string sources and skips the manifest itself", () => {
    assert.deepEqual(extractJsonFiles(LEGACY_BUNDLE), ["atlases/sprites-0.json"]);
  });

  it("returns an empty list for an invalid bundle", () => {
    assert.deepEqual(extractJsonFiles(null), []);
    assert.deepEqual(extractJsonFiles({}), []);
  });
});

describe("extractAllSources", () => {
  it("unwraps object sources so non-JSON assets stay discoverable", () => {
    const sources = extractAllSources(MULTI_RESOLUTION_BUNDLE);
    assert.ok(
      sources.includes("atlases/sprites-2x-0.json"),
      "full-resolution atlas missing from sources"
    );
    assert.ok(
      sources.includes("/runtime-assets/avatar.a37070e0f510200217b1.riv"),
      "legacy string source missing from sources"
    );
  });
});

describe("assetSourcePaths", () => {
  // Shape captured from https://magicgarden.gg/version/1231/assets/manifest.json.
  // The descriptor carries `progressSize` and no `resolution` — the bundles
  // `cosmetic` and `audio` moved to it, and every extractor that filtered on
  // `typeof src === "string"` silently returned nothing from that version on.
  it("reads descriptors that carry progressSize instead of resolution", () => {
    assert.deepEqual(
      assetSourcePaths({
        alias: ["cosmetic/Banner_Fire.png"],
        src: [{ src: "cosmetic/Banner_Fire.png", progressSize: 4.67 }],
      }),
      ["cosmetic/Banner_Fire.png"]
    );
  });

  it("keeps every variant, unlike the JSON atlas extraction", () => {
    assert.deepEqual(assetSourcePaths(MULTI_RESOLUTION_BUNDLE.assets[0]), [
      "atlases/sprites-1x-0.json",
      "atlases/sprites-2x-0.json",
    ]);
  });

  it("still reads legacy plain strings", () => {
    assert.deepEqual(assetSourcePaths({ src: ["audio/sfx/sfx.mp3"] }), ["audio/sfx/sfx.mp3"]);
  });

  it("returns an empty list for an asset without usable sources", () => {
    assert.deepEqual(assetSourcePaths(null), []);
    assert.deepEqual(assetSourcePaths({}), []);
    assert.deepEqual(assetSourcePaths({ src: [42, null, { nope: true }] }), []);
  });
});
