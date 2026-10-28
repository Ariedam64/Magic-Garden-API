// tests/asset-cache.test.js
//
// Les fichiers de sprites et d'animations sont servis `immutable` pendant un
// an. Le 2026-10-28 des joueurs ont gardé des sprites cassés après la
// correction : les URL ne dépendaient que de la version du jeu (`?v=1778`) et
// n'avaient pas changé, et les erreurs partaient avec le même en-tête.

import test from "node:test";
import assert from "node:assert/strict";

import { assetVersionToken, nextAssetRevision } from "../src/core/game/versionStorage.js";
import { buildSpriteUrl } from "../src/utils/spriteUrlBuilder.js";
import { Errors, errorHandler } from "../src/api/middleware/errorHandler.js";

test("rewriting the files of the stored version moves the asset revision", () => {
  assert.equal(nextAssetRevision({ version: "1778" }, "1778"), 1);
  assert.equal(nextAssetRevision({ version: "1778", assetRevision: 1 }, "1778"), 2);
  assert.equal(nextAssetRevision({ version: "1778", assetRevision: 3 }, "1779"), 0);
  assert.equal(nextAssetRevision(null, "1778"), 0);
});

test("the cache token adds the revision to the game version", () => {
  assert.equal(assetVersionToken({ version: "1778", assetRevision: 0 }), "1778");
  assert.equal(assetVersionToken({ version: "1778" }), "1778");
  assert.equal(assetVersionToken({ version: "1778", assetRevision: 2 }), "1778-r2");
  assert.equal(assetVersionToken(null), null);

  const url = buildSpriteUrl("plants", "Carrot", { baseUrl: "https://api.test", version: "1778-r2" });
  assert.equal(url, "https://api.test/assets/sprites/plants/Carrot.png?v=1778-r2");
});

test("an error response is never cacheable, even after a long Cache-Control", () => {
  const headers = { "cache-control": "public, max-age=86400" };
  const res = {
    headersSent: false,
    set(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status() {
      return this;
    },
    json() {
      return this;
    },
  };

  errorHandler(Errors.notFound("Sprite not found"), { method: "GET", path: "/x", query: {} }, res, () => {});
  assert.equal(headers["cache-control"], "no-store");
});
