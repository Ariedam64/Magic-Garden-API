// tests/lru-cache.test.js
//
// Cache LRU borné utilisé par la composition de sprites, dont les entrées
// (atlas décodés) pèsent jusqu'à 64 Mo pièce : une borne qui fuit se paie en
// centaines de Mo de swap.
//
// Usage: node --test tests/lru-cache.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

import { LruCache } from "../src/utils/lruCache.js";

describe("LruCache", () => {
  it("evicts the least recently used entry beyond `max`", () => {
    const cache = new LruCache({ max: 2 });
    cache.set("a", 1).set("b", 2);
    assert.equal(cache.get("a"), 1); // "a" redevient le plus récent
    cache.set("c", 3);
    assert.equal(cache.has("b"), false);
    assert.deepEqual([cache.get("a"), cache.get("c")], [1, 3]);
    assert.equal(cache.size, 2);
  });

  it("bounds the cumulated size and keeps the byte count exact", () => {
    const cache = new LruCache({ maxBytes: 10, sizeOf: (v) => v.length });
    cache.set("a", "xxxx").set("b", "yyyy");
    assert.equal(cache.bytes, 8);
    cache.set("c", "zzzz");
    assert.equal(cache.has("a"), false);
    assert.equal(cache.bytes, 8);
    cache.set("b", "y"); // remplacement : l'ancienne taille est retirée
    assert.equal(cache.bytes, 5);
    cache.delete("c");
    assert.equal(cache.bytes, 1);
  });

  it("refuses a value larger than the whole cache instead of flushing it", () => {
    const cache = new LruCache({ maxBytes: 10, sizeOf: (v) => v.length });
    cache.set("a", "xxxx");
    cache.set("huge", "x".repeat(11));
    assert.equal(cache.has("huge"), false);
    assert.equal(cache.get("a"), "xxxx");
  });

  it("drops entries left idle, but not the ones still in use", async () => {
    const cache = new LruCache({ idleMs: 60 });
    cache.set("idle", 1).set("busy", 2);
    for (let i = 0; i < 4; i++) {
      await sleep(25);
      cache.get("busy");
    }
    assert.equal(cache.has("idle"), false);
    assert.equal(cache.get("busy"), 2);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.bytes, 0);
  });

  it("stores nothing when max is 0", () => {
    const cache = new LruCache({ max: 0 });
    cache.set("a", 1);
    assert.equal(cache.size, 0);
  });
});
