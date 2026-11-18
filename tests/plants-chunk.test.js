// tests/plants-chunk.test.js
//
// En 2071 le catalogue des plantes a quitté `tools-*` (où il vivait avec les
// œufs et les items) pour un chunk à lui, `flora-*`. Aucune cible du résolveur
// ne le retenait : `[plants] not found (signatures not matched)` et
// /data/plants est passé en 500. Le jeu servi ci-dessous reprend la forme
// réelle, en miniature.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";
import { extractPlants } from "../src/core/extractors/plants.js";

const ORIGIN = "https://game.test/version/9999/";
const FILES = {
  "index.html": '<script type="module" src="/version/9999/assets/index-a1.js"></script>',
  "assets/index-a1.js": 'import("./tools-b2.js");',
  "assets/tools-b2.js":
    'import{o as m}from"./flora-c3.js";' +
    "var jt={CommonEgg:{name:`Common Egg`,secondsToHatch:600}}," +
    "it={Shovel:{name:`Shovel`,maxInventoryQuantity:1,isOneTimePurchase:!0,grantedMutation:null}};",
  "assets/flora-c3.js":
    "var l=function(e){return e.Single=`Single`,e.Multiple=`Multiple`,e}({});" +
    "function p(e,t={}){return Array.from({length:e},()=>({...t}))}" +
    "var m={Carrot:{name:`Carrot`,seed:{sprite:n.Seed.Carrot,name:`Carrot Seed`,coinPrice:10}," +
    "plant:{sprite:n.Plant.BabyCarrot,name:`Carrot Plant`,harvestType:l.Single,baseTileScale:.7}," +
    "crop:{sprite:n.Plant.Carrot,name:`Carrot`,baseSellPrice:20}}," +
    "Cabbage:{name:`Cabbage`,seed:{sprite:n.Seed.Cabbage,name:`Cabbage Seed`,coinPrice:30}," +
    "plant:{sprite:n.Plant.CabbagePlant,name:`Cabbage Plant`,harvestType:l.Multiple,growSlots:p(1),secondsToMature:45}," +
    "crop:{sprite:n.Plant.Cabbage,name:`Cabbage`,baseSellPrice:40}}};export{m as o};",
};

test("the plant catalog is read from its own chunk", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = FILES[String(url).slice(ORIGIN.length)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };

  try {
    const { dataSources } = await fetchMainBundle(`${ORIGIN}index.html`);

    // Même boucle que getCategoryCached : le premier chunk qui aboutit gagne.
    let plants = null;
    for (const source of dataSources) {
      try {
        plants = extractPlants(source, null, [], null, null, dataSources);
        break;
      } catch {
        // chunk suivant
      }
    }

    assert.deepEqual(Object.keys(plants ?? {}), ["Carrot", "Cabbage"]);
    assert.equal(plants.Cabbage.plant.growSlots.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
