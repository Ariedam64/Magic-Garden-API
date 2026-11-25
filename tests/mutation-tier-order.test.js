// tests/mutation-tier-order.test.js
//
// Jusqu'à la 2184 le jeu écrivait la liste des mutations météo en dur :
//   Zt=[`Wet`,`Chilled`,`Frozen`,`Thunderstruck`,`Dawnlit`,`Ambershine`,
//       `Dawncharged`,`Ambercharged`,`Thundercharged`]
// La 2198 l'a supprimée : le jeu la déduit maintenant du catalogue des
// mutations (`dn=e=>X.filter(t=>Y[t].group===e)`, `hn=dn(`Growth`)`).
// `/data/enums` perdait donc `mutationTierOrder`.
//
// Extraits réels du chunk `tools-DlkITWDy.js` (2198).

import test from "node:test";
import assert from "node:assert/strict";

import { extractEnums } from "../src/core/extractors/enums.js";

const CATALOG_2198 =
  "var Y={Gold:{name:`Gold`,baseChance:.01,coinMultiplier:25,group:`Growth`}," +
  "Rainbow:{name:`Rainbow`,baseChance:.001,coinMultiplier:50,group:`Growth`}," +
  "Wet:{name:`Wet`,baseChance:0,coinMultiplier:2,group:`Hydro`,sprite:_.Mutation.Wet}," +
  "Chilled:{name:`Chilled`,baseChance:0,coinMultiplier:2,group:`Hydro`,sprite:_.Mutation.Chilled}," +
  "Frozen:{name:`Frozen`,baseChance:0,coinMultiplier:6,group:`Hydro`,sprite:_.Mutation.Frozen}," +
  "Thunderstruck:{name:`Thunderstruck`,baseChance:0,coinMultiplier:5,group:`Hydro`,sprite:_.Mutation.Thunderstruck}," +
  "Dawnlit:{name:`Dawnlit`,baseChance:0,coinMultiplier:4,group:`Lunar`,sprite:_.Mutation.Dawnlit}," +
  "Ambershine:{name:`Amberlit`,baseChance:0,coinMultiplier:6,group:`Lunar`,sprite:_.Mutation.Amberlit}," +
  "Dawncharged:{name:`Dawnbound`,baseChance:0,coinMultiplier:7,group:`Lunar`,sprite:_.Mutation.Dawncharged}," +
  "Ambercharged:{name:`Amberbound`,baseChance:0,coinMultiplier:10,group:`Lunar`,sprite:_.Mutation.Ambercharged}," +
  "Thundercharged:{name:`Thundercharged`,baseChance:0,coinMultiplier:7,group:`Hydro`,sprite:_.Mutation.Thundercharged}}," +
  "X=Object.keys(Y);function dn(e){return X.filter(t=>Y[t].group===e)}var hn=dn(`Growth`);";

const TIERS = [
  "Wet",
  "Chilled",
  "Frozen",
  "Thunderstruck",
  "Dawnlit",
  "Ambershine",
  "Dawncharged",
  "Ambercharged",
  "Thundercharged",
];

test("2198 : l'ordre des tiers est déduit du catalogue des mutations", () => {
  const enums = extractEnums(CATALOG_2198, null, null, null, null, [CATALOG_2198]);

  assert.deepEqual(enums.mutationTierOrder, TIERS);
});

test("la liste écrite en dur (<= 2184) reste prioritaire", () => {
  const hardcoded = "var Zt=[`Wet`,`Chilled`,`Frozen`,`Thunderstruck`,`Dawnlit`];function Qt(e){return Zt.some(t=>t===e)}";
  const enums = extractEnums(hardcoded, null, null, null, null, [hardcoded, CATALOG_2198]);

  assert.deepEqual(enums.mutationTierOrder, ["Wet", "Chilled", "Frozen", "Thunderstruck", "Dawnlit"]);
});

test("sans liste ni catalogue, la clé est omise", () => {
  const enums = extractEnums("var a=1;", null, null, null, null, ["var a=1;"]);

  assert.equal("mutationTierOrder" in enums, false);
});
