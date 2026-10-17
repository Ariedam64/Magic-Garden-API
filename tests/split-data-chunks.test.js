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
import { fetchImportedDateChunks } from "../src/core/game/bundle/resolver.js";

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

test("the expiry dates chunk is fetched when only a catalog imports it", async () => {
  // Forme réelle 1598+ : les dates vivent dans `expiryDates-*.js`, un chunk
  // qu'aucune cible du parcours ne retient. Sans le suivre, tout sortait en `{}`.
  const catalogUrl = "https://x/version/1608/assets/modalAtom-DKJlaxGg.js";
  const datesUrl = "https://x/version/1608/assets/expiryDates-D0M2yI8F.js";
  const catalog =
    'import{a as Me,i as Ne,n as Pe,r as Fe,t as Ie}from"./expiryDates-D0M2yI8F.js";' +
    'import{t as Zz}from"./unrelated-abc.js";' +
    "var tn={HauntLamp:{name:`Haunt Lamp`,expiryDate:Ie},Rose:{expiryDate:Pe}};";
  const dates =
    "var e=new Date(`2026-01-12T01:00:00.000Z`),t=new Date(`2026-02-23T01:00:00.000Z`)," +
    "n=new Date(`2026-03-01T01:00:00.000Z`),r=new Date(`2026-03-22T01:00:00.000Z`)," +
    "i=new Date(`2026-11-10T00:00:00.000Z`);export{e as a,t as i,n,r,i as t};";

  const requested = [];
  const fetched = await fetchImportedDateChunks([{ url: catalogUrl, content: catalog }], async (url) => {
    requested.push(url);
    return dates;
  });
  // Seul le chunk qui fournit une date est téléchargé.
  assert.deepEqual(requested, [datesUrl]);

  setLinkedChunks([{ url: catalogUrl, content: catalog }, ...fetched]);
  const sandbox = {};
  applyDateConstants(catalog, "{HauntLamp:{expiryDate:Ie},Rose:{expiryDate:Pe}}", sandbox);
  assert.equal(sandbox.Ie?.toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(sandbox.Pe?.toISOString(), "2026-03-01T01:00:00.000Z");
  setLinkedChunks([]);
});

test("an expiry dates chunk already loaded is not fetched again", async () => {
  const catalog = 'import{t as Ie}from"./expiryDates-a.js";var x={A:{expiryDate:Ie}};';
  const chunks = [
    { url: "https://x/assets/cat.js", content: catalog },
    { url: "https://x/assets/expiryDates-a.js", content: "var i=new Date(`2026-11-10T00:00:00.000Z`);export{i as t};" },
  ];
  const fetched = await fetchImportedDateChunks(chunks, async () => assert.fail("should not fetch"));
  assert.deepEqual(fetched, []);
});

test("rare crop pairs are read from the game's patch table", async () => {
  const { extractRareCropPairs } = await import("../src/core/extractors/plants.js");
  // Forme réelle 1608.
  const js =
    "Ap=[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`},{patchSpeciesId:`Foxfire`,rareCropSpeciesId:`Witchfire`}]," +
    "jp=Object.fromEntries(Ap.map(({patchSpeciesId:e,rareCropSpeciesId:t})=>[e,t]))";
  assert.deepEqual(extractRareCropPairs(js), [
    { patch: "Daisy", rareCrop: "PurpleDaisy" },
    { patch: "Foxfire", rareCrop: "Witchfire" },
  ]);
});
