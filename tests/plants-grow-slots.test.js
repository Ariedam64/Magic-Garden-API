// tests/plants-grow-slots.test.js
//
// En 1778 le catalogue des plantes appelle un utilitaire déclaré juste avant
// lui (`growSlots:P(5)`). Le sandbox ne le connaissait pas : `P is not a
// function`, et /data/plants répondait `{}`. Dans la même version, les
// positions des fruits (`slotOffsets`) sont parties dans une table de
// `weatherVisuals-*`. Les extraits reprennent la forme réelle du bundle.

import test from "node:test";
import assert from "node:assert/strict";

import { extractPlants, extractSlotOffsets } from "../src/core/extractors/plants.js";

const HARVEST_ENUM =
  "N=function(e){return e.Single=`Single`,e.Multiple=`Multiple`,e}({});";
const HELPER = "function P(e,t={}){return Array.from({length:e},()=>({...t}))}";
const CATALOG =
  "var F={Carrot:{name:`Carrot`,seed:{sprite:m.Seed.Carrot,name:`Carrot Seed`,coinPrice:10}," +
  "plant:{sprite:m.Plant.BabyCarrot,name:`Carrot Plant`,harvestType:N.Single,baseTileScale:.7}," +
  "crop:{sprite:m.Plant.Carrot,name:`Carrot`,baseSellPrice:20}}," +
  "Strawberry:{name:`Strawberry`,seed:{sprite:m.Seed.Strawberry,name:`Strawberry Seed`,coinPrice:50}," +
  "plant:{sprite:m.Plant.SproutFruit,name:`Strawberry Plant`,harvestType:N.Multiple,growSlots:P(5),secondsToMature:70}," +
  "crop:{sprite:m.Plant.Strawberry,name:`Strawberry`,baseSellPrice:14}}};";

test("a helper called by the plant catalog is resolved from its declaration", () => {
  const plants = extractPlants(`var ${HARVEST_ENUM}${HELPER}${CATALOG}`);

  assert.deepEqual(Object.keys(plants), ["Carrot", "Strawberry"]);
  assert.equal(plants.Strawberry.plant.growSlots.length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(plants.Strawberry.plant.growSlots[0])), {});
  assert.equal(plants.Strawberry.plant.secondsToMature, 70);
});

test("the helper declared closest before the catalog wins over a homonym", () => {
  // Les noms minifiés se répètent d'une portée à l'autre.
  const homonym = "function P(e){return `not this one`}";
  const plants = extractPlants(`${homonym}var ${HARVEST_ENUM}${HELPER}${CATALOG}`);

  assert.equal(plants.Strawberry.plant.growSlots.length, 5);
});

test("slotOffsets are rebuilt from the separate positions table", () => {
  const table =
    "var kr={Strawberry:{randomRotation:!0,slots:[{x:-.2,y:-.2,rotation:4.25},{x:.2,y:-.25,rotation:4.25}," +
    "{x:-.18,y:.12,rotation:4.25},{x:.2,y:.05,rotation:4.25},{x:.01,y:-.1,rotation:4.25}]}};";
  const plants = extractPlants(`var ${HARVEST_ENUM}${HELPER}${CATALOG}`, null, [], null, null, [], {
    slotOffsetsSource: table,
  });

  const strawberry = plants.Strawberry.plant;
  assert.equal(strawberry.rotateSlotOffsetsRandomly, true);
  assert.deepEqual(JSON.parse(JSON.stringify(strawberry.slotOffsets[1])), { x: 0.2, y: -0.25, rotation: 4.25 });
  assert.equal(strawberry.slotOffsets.length, 5);
  assert.equal(plants.Carrot.plant.slotOffsets, undefined);
});

test("a slot's own fields are kept next to its position", () => {
  // Thunderspire : `growSlots:[...P(4,{speciesOverride:...}),...P(12)]`.
  const catalog =
    "var F={ThunderCelestial:{name:`Thunderspire`,seed:{sprite:m.Seed.ThunderCelestial,name:`Thunderspire Seed`}," +
    "plant:{sprite:m.Plant.ThunderCelestial,name:`Thunderspire Plant`,harvestType:N.Multiple," +
    "growSlots:[...P(1,{speciesOverride:`ThunderCelestialShroomPlant`}),...P(1)]}," +
    "crop:{sprite:m.Plant.ThunderCelestial,name:`Thunderspire`}}};";
  const table =
    "var kr={ThunderCelestial:{randomRotation:!1,slots:[{x:.44,y:-.03,rotation:0},{x:.55,y:.43,rotation:0}]}};";
  const plants = extractPlants(`var ${HARVEST_ENUM}${HELPER}${catalog}`, null, [], null, null, [], {
    slotOffsetsSource: table,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(plants.ThunderCelestial.plant.slotOffsets)), [
    { x: 0.44, y: -0.03, rotation: 0, speciesOverride: "ThunderCelestialShroomPlant" },
    { x: 0.55, y: 0.43, rotation: 0 },
  ]);
});

test("a chunk without the positions table yields no table", () => {
  assert.equal(extractSlotOffsets("var a={b:1};"), null);
  assert.equal(extractSlotOffsets(null), null);
});
