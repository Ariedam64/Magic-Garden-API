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
import { extractJsonFiles, extractAllSources } from "../src/assets/manifest.js";

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
