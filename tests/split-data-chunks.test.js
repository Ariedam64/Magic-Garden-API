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
import { applyDateConstants, setLinkedChunks } from "../src/core/extractors/sandbox.js";

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


test("an expiry date imported from another chunk is resolved in that chunk", () => {
  // Forme réelle 1324 : RoomConnection importe la date depuis LocalizedTextContent.
  const catalog =
    'import{cr as Ht,cq as Hu}from"./LocalizedTextContent-4u-qHixS.js";' +
    "var tn={PaperLantern:{name:`Paper Lantern`,expiryDate:Ht}};";
  const other =
    "var Ot=new Date(`2026-03-01T01:00:00.000Z`),Hs=new Date(`1999-01-01T00:00:00.000Z`);" +
    "export{Ot as cr,Hs as cq};";
  // Un autre chunk exporte aussi un `cr` : seul le fichier importé compte.
  const decoy = "var Zz=new Date(`2000-01-01T00:00:00.000Z`);export{Zz as cr};";
  setLinkedChunks([
    { url: "https://x/assets/Decoy-aaa.js", content: decoy },
    { url: "https://x/assets/LocalizedTextContent-4u-qHixS.js", content: other },
  ]);
  const sandbox = {};
  applyDateConstants(catalog, "{PaperLantern:{expiryDate:Ht}}", sandbox);
  assert.equal(sandbox.Ht?.toISOString(), "2026-03-01T01:00:00.000Z");
  setLinkedChunks([]);
});
