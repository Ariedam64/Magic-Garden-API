// tests/rarity-enum-chunk.test.js
//
// Mi-novembre 2026 l'enum Rarity a quitté les chunks de données pour un chunk
// à part (`rarity-*.js`), et n'est plus une IIFE (`function(e){return e.A=...}`)
// mais un simple littéral (`$={Common:`Common`,...,Mythic:`Mythical`}`). Aucune
// cible du résolveur ne le retenait et le scanner ne lisait que les IIFE :
// /data/enums a perdu `rarity`, et les jetons de rareté des descriptions
// d'abilities sortaient comme des items. Forme réelle (2184), en miniature.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";
import { extractEnums, findStringEnumMap } from "../src/core/extractors/enums.js";

const ORIGIN = "https://game.test/version/9999/";
const RARITY_CHUNK =
  "var a=(e=>(e.Application=`application`,e.WebGLPipes=`webgl-pipes`,e))({})," +
  "$={Common:`Common`,Uncommon:`Uncommon`,Rare:`Rare`,Legendary:`Legendary`,Mythic:`Mythical`,Divine:`Divine`,Celestial:`Celestial`}," +
  "Yu={[$.Common]:`sprite/ui/RarityCommon`};export{$ as t};";
const FILES = {
  "index.html": '<script type="module" src="/version/9999/assets/index-a1.js"></script>',
  "assets/index-a1.js": 'import("./tools-b2.js");',
  "assets/tools-b2.js":
    'import{t as je}from"./rarity-c3.js";var jt={CommonEgg:{name:`Common Egg`,secondsToHatch:600}};',
  "assets/rarity-c3.js": RARITY_CHUNK,
};

test("an enum written as a plain literal is read, key to canonical value", () => {
  assert.deepEqual(findStringEnumMap(RARITY_CHUNK, ["Common", "Uncommon", "Rare"]), {
    Common: "Common",
    Uncommon: "Uncommon",
    Rare: "Rare",
    Legendary: "Legendary",
    Mythic: "Mythical",
    Divine: "Divine",
    Celestial: "Celestial",
  });
});

test("the rarity enum is read from its own chunk", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = FILES[String(url).slice(ORIGIN.length)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };

  try {
    const { mainJs, dataSources } = await fetchMainBundle(`${ORIGIN}index.html`);
    const enums = extractEnums(mainJs, null, [], null, null, dataSources);
    assert.deepEqual(enums.rarity, ["Common", "Uncommon", "Rare", "Legendary", "Mythical", "Divine", "Celestial"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
