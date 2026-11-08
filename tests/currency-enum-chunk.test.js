// tests/currency-enum-chunk.test.js
//
// Fin octobre 2026 l'enum des monnaies a quitté les chunks de données pour un
// chunk à lui (`currency-*.js`, importé par `modalAtom-*`). Aucune cible du
// résolveur ne le retenait et /data/enums a perdu `currency`. Le jeu servi
// ci-dessous reprend la forme réelle, en miniature.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";
import { extractEnums } from "../src/core/extractors/enums.js";

const ORIGIN = "https://game.test/version/9999/";
const FILES = {
  "index.html": '<script type="module" src="/version/9999/assets/index-a1.js"></script>',
  "assets/index-a1.js": 'import("./petMotion-b2.js");',
  "assets/petMotion-b2.js":
    'import{t as je}from"./currency-c3.js";var jt={CommonEgg:{name:`Common Egg`,secondsToHatch:600}};',
  "assets/currency-c3.js":
    "var r=function(e){return e.Coins=`coins`,e.Credits=`credits`,e.MagicDust=`magicDust`,e}({});export{r as t};",
};

test("the currency enum is read from its own chunk", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = FILES[String(url).slice(ORIGIN.length)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };

  try {
    const { mainJs, dataSources } = await fetchMainBundle(`${ORIGIN}index.html`);
    const enums = extractEnums(mainJs, null, [], null, null, dataSources);
    assert.deepEqual(enums.currency, ["coins", "credits", "magicDust"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
