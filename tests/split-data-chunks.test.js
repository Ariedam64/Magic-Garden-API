// tests/split-data-chunks.test.js
//
// En 1324 le chunk de données du jeu s'est scindé en deux : les œufs, pets et
// abilities sont partis dans `LocalizedTextContent-*`, les items, décors,
// plantes, mutations et l'ordre des tiers sont restés dans `RoomConnection-*`.
// L'API ne lisait qu'un chunk et /data/items, /data/decors et /data/mutations
// sont passés en 500. Les extraits ci-dessous reprennent la forme réelle.

import test from "node:test";
import assert from "node:assert/strict";

import { extractEnums } from "../src/core/extractors/enums.js";

const EGGS_CHUNK =
  "var D=40,jt={CommonEgg:{name:`Common Egg`,coinPrice:1e5,secondsToHatch:600}};";
const CATALOG_CHUNK =
  "var no=[`Wet`,`Chilled`,`Frozen`,`Thunderstruck`,`Dawnlit`,`Ambershine`,`Dawncharged`,`Ambercharged`,`Thundercharged`];";

test("the mutation tier order is found in the second data chunk", () => {
  const enums = extractEnums(EGGS_CHUNK, null, [], null, null, [EGGS_CHUNK, CATALOG_CHUNK]);
  assert.deepEqual(enums.mutationTierOrder, [
    "Wet", "Chilled", "Frozen", "Thunderstruck", "Dawnlit", "Ambershine",
    "Dawncharged", "Ambercharged", "Thundercharged",
  ]);
});

test("the tier order still reads when the data lives in a single chunk", () => {
  const enums = extractEnums(CATALOG_CHUNK, null, [], null, null);
  assert.equal(enums.mutationTierOrder?.[0], "Wet");
});

