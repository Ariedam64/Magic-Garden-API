// tests/ability-text.test.js
//
// Unit tests for ability descriptions.
//
// They live in the UI chunk, not the data chunk, and are parsed out of minified
// code whose identifiers change at every build, so the fixtures below reproduce
// the shapes observed in the live bundle (magicgarden.gg version 1063) rather
// than any particular variable name.
//
// Usage: node --test tests/ability-text.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractAbilityDescriptions } from "../src/core/extractors/abilityText.js";

// Helpers du chunk UI, tels que minifiés par le jeu : le message est soit
// inline, soit derrière une constante partagée (`WG`), soit construit par un
// helper (`GG`). Les jetons passent par des fabriques de tags typées.
const UI_CHUNK = [
  "function HG(e){return Z(e,{})}",
  "function GG(e){return Z(obe,{0:zG(e)})}",
  "function zG(e){return{mutation:e}}",
  "function Ow(e,t,n){return{gameThing:{name:e,sprite:t},...n!==void 0&&{iconSizePx:n}}}",
  "function BG(e){return Ow(``,Vf[e].sprite,RG)}",
  "function KG(e){return Ow(iw[e],Md[e],RG)}",
  "function kw(e){let{name:t,sprite:n}=K[e].crop;return Ow(t,n)}",
  "function vw(e){return{kind:`currency`,currency:e,amount:null}}",
  "var VG={currency:vw($u.Coins)}," +
    "obe={id:`P+xkUg`,message:`Chance to grant <0/> mutation to a garden crop`}," +
    "UG={id:`UkDco8`,message:`Finds <0/> seeds`}," +
    "WG={id:`hXSxzt`,message:`Finds <0/> or <1/> seeds`};",
  "function qG(e){switch(e){",
  "case`MoonKisser`:return Z({id:`8BUN7/`,message:`Chance to replace <0/> with <1/> mutation`}," +
    "{0:zG(`Ambershine`),1:zG(`Ambercharged`)});",
  "case`GoldGranter`:return GG(`Gold`);",
  "case`RainDance`:return GG(`Wet`);",
  "case`DoubleHarvest`:return HG({id:`Wg0Nq6`,message:`Chance to harvest an extra crop`});",
  "case`Copycat`:return HG({id:`RpKAL4`,message:`Chance to copy ability of another active pet`});",
  "case`CoinFinderI`:return Z({id:`Wbtnc2`,message:`Chance to find <0/> coins`},{0:VG});",
  "case`DawnCapture`:return Z({id:`NhLLCo`,message:`Convert nearby crops to <0/> capsules`}," +
    "{0:BG(`DawnCapsule`)});",
  "case`Thunderbloom`:return Z({id:`O2E7dG`,message:`Grows additional <0/> crops`}," +
    "{0:kw(`ThunderCelestialShroomPlant`)});",
  "case`SeedFinderI`:return Z(WG,{0:KG(Ap.SeedFinderI[0]),1:KG(Ap.SeedFinderI[1])});",
  "case`SeedFinderIII`:return Z(UG,{0:KG(Ap.SeedFinderIII[0])});",
  "default:return e}}",
].join("");

// Chunk de données : tables indexées + enum Rarity (dont la clé `Mythic` porte
// la valeur canonique `Mythical`).
const DATA_CHUNK = [
  "var Ap={SeedFinderI:[F.Common,F.Uncommon],SeedFinderIII:[F.Mythic]};",
  "var Rarity=function(e){return e.Common=`Common`,e.Uncommon=`Uncommon`,e.Rare=`Rare`," +
    "e.Legendary=`Legendary`,e.Mythic=`Mythical`,e.Divine=`Divine`,e};",
].join("");

describe("extractAbilityDescriptions", () => {
  const descriptions = extractAbilityDescriptions(UI_CHUNK, DATA_CHUNK);

  it("extracts every ability of the switch", () => {
    assert.deepEqual(Object.keys(descriptions).sort(), [
      "CoinFinderI",
      "Copycat",
      "DawnCapture",
      "DoubleHarvest",
      "GoldGranter",
      "MoonKisser",
      "RainDance",
      "SeedFinderI",
      "SeedFinderIII",
      "Thunderbloom",
    ]);
  });

  it("reads a message declared inline", () => {
    assert.deepEqual(descriptions.DoubleHarvest, {
      description: "Chance to harvest an extra crop",
      descriptionTokens: [],
    });
  });

  it("resolves a message built by a helper", () => {
    assert.deepEqual(descriptions.GoldGranter, {
      description: "Chance to grant <0/> mutation to a garden crop",
      descriptionTokens: [{ type: "mutation", id: "Gold" }],
    });
  });

  it("resolves a message held in a shared constant", () => {
    assert.equal(descriptions.SeedFinderI.description, "Finds <0/> or <1/> seeds");
  });

  it("orders tokens on the message placeholders", () => {
    assert.deepEqual(descriptions.MoonKisser.descriptionTokens, [
      { type: "mutation", id: "Ambershine" },
      { type: "mutation", id: "Ambercharged" },
    ]);
  });

  it("types item, crop and currency tokens", () => {
    assert.deepEqual(descriptions.DawnCapture.descriptionTokens, [
      { type: "item", id: "DawnCapsule" },
    ]);
    assert.deepEqual(descriptions.Thunderbloom.descriptionTokens, [
      { type: "crop", id: "ThunderCelestialShroomPlant" },
    ]);
    assert.deepEqual(descriptions.CoinFinderI.descriptionTokens, [
      { type: "currency", id: "Coins" },
    ]);
  });

  it("resolves rarity tokens through the data chunk table, canonical value included", () => {
    assert.deepEqual(descriptions.SeedFinderI.descriptionTokens, [
      { type: "rarity", id: "Common" },
      { type: "rarity", id: "Uncommon" },
    ]);
    // Le bundle référence la clé `Mythic`, l'API expose la valeur `Mythical`.
    assert.deepEqual(descriptions.SeedFinderIII.descriptionTokens, [
      { type: "rarity", id: "Mythical" },
    ]);
  });

  it("gives every placeholder a token", () => {
    for (const [name, entry] of Object.entries(descriptions)) {
      const placeholders = [...entry.description.matchAll(/<(\d+)\/>/g)].map((m) => Number(m[1]));
      for (const index of placeholders) {
        assert.ok(entry.descriptionTokens[index], `${name}: no token for <${index}/>`);
      }
    }
  });

  it("degrades to an empty map instead of throwing", () => {
    assert.deepEqual(extractAbilityDescriptions(null, DATA_CHUNK), {});
    assert.deepEqual(extractAbilityDescriptions("var x=1;", DATA_CHUNK), {});
  });
});
