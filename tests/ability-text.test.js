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

describe("ability descriptions with values (Crop Size Boost, 1608)", () => {
  // Forme réelle 1608 : le message est enveloppé avec ses valeurs par un helper
  // importé (`V(desc, values)` = `{ ...desc, values }`), le paramètre est lu
  // dans le catalogue de l'ability, et l'icône est une constante construite
  // par un appel (`Vb=Lo(``,c.Ui.Size,Ib)`).
  const UI = [
    "var Ib=18,Gb={id:`/C7193`,message:`Chance to increase size of garden crops by {sizeIncrease} <0/>`}," +
      "Kb={id:`bkMAGm`,message:`Chance to increase size of garden crops by {sizeIncrease} <0/> during Snow`}," +
      "Vb=Lo(``,c.Ui.Size,Ib);",
    "function qG(e){switch(e){",
    "case`ProduceScaleBoost`:case`ProduceScaleBoostII`:case`SnowyCropSizeBoost`:" +
      "return Y(V(e===`SnowyCropSizeBoost`?Kb:Gb,{sizeIncrease:L(nn[e].baseParameters.sizeIncrease,{signDisplay:`always`})}),{0:Vb});",
    "case`ProduceMutationBoost`:return Z({id:`INyz4p`,message:`Increases chance of garden crops gaining weather mutations`});",
    "case`PetMutationBoost`:return Z({id:`wGIyjc`,message:`Increases chance of hatched pets gaining mutations`});",
    "case`HungerRestore`:return Z({id:`LP/vSz`,message:`Restores hunger`});",
    "case`DoubleHarvest`:return Z({id:`Wg0Nq6`,message:`Chance to harvest an extra crop`});",
    "case`GoldGranter`:return Z({id:`P+xkUg`,message:`Chance to grant gold`});",
    "case`RainDance`:return Z({id:`x`,message:`Rain`});",
    "}}",
  ].join("");
  const DATA = "var F=function(e){return e.Common=`Common`,e.Uncommon=`Uncommon`,e.Rare=`Rare`,e}({});";

  const descriptions = extractAbilityDescriptions(UI, DATA);

  it("finds the message wrapped with its values, per ability", () => {
    assert.equal(
      descriptions.ProduceScaleBoost.description,
      "Chance to increase size of garden crops by {sizeIncrease} <0/>"
    );
    assert.match(descriptions.SnowyCropSizeBoost.description, /during Snow$/);
  });

  it("publishes which parameter fills each placeholder, and its format", () => {
    assert.deepEqual(descriptions.ProduceScaleBoostII.descriptionValues, {
      sizeIncrease: { parameter: "sizeIncrease", format: { signDisplay: "always" } },
    });
  });

  it("reads an icon built by a helper constant", () => {
    assert.deepEqual(descriptions.ProduceScaleBoost.descriptionTokens, [{ type: "icon", id: "Size" }]);
  });
});

describe("ability descriptions with named placeholders (2184)", () => {
  // Forme réelle 2184 (chunk `seededShuffle-*`). Deux changements :
  //   - un message sans jeton est renvoyé nu, sans helper autour
  //     (`return{id,message}`) : 50 abilities sortaient sans description ;
  //   - les jetons ne sont plus positionnels (`<0/>` + `{0: tag}`) mais nommés
  //     (`{coins}` + `{coins: tag}`), chaque tag enveloppé par un helper
  //     importé (`L(...)`).
  // L'API garde son contrat : `<n/>` dans le message, `descriptionTokens[n]`.
  const UI = [
    "function eD(e){return L({mutation:e})}",
    "function tD(e){return L($n(e,$E))}",
    "var $E=18,nD=L({currency:bc.Coins}),rD=L({currency:bc.MagicDust}),iD=L(qn(``,C.Ui.Size,$E))," +
      "aD={id:`S6k_Y9`,message:`Chance to grant {mutation} mutation to a garden crop`}," +
      "oD={id:`PoZ3pN`,message:`Finds {rarity} seeds`}," +
      "sD={id:`JTepyX`,message:`Finds {firstRarity} or {secondRarity} seeds`}," +
      "cD={id:`bILilD`,message:`Chance to increase size of garden crops by {sizeIncrease} {sizeIcon}`};",
    "function uD(e){return I(aD,{mutation:eD(e)})}",
    "function dD(e){return L(Ln(e,$E))}",
    "function pD(e){switch(e){",
    "case`ProduceEater`:return{id:`4NHuSC`,message:`Chance to eat non-mutated crops for Coins`};",
    "case`DoubleHarvest`:return{id:`Wg0Nq6`,message:`Chance to harvest an extra crop`};",
    "case`DoubleHatch`:case`DoubleHatchII`:return{id:`Qqidt7`,message:`Chance to hatch an extra pet (fraternal siblings)`};",
    "case`Copycat`:return{id:`RpKAL4`,message:`Chance to copy ability of another active pet`};",
    "case`CoinFinderI`:case`CoinFinderII`:return I({id:`72rwe3`,message:`Chance to find {coins} Coins`},{coins:nD});",
    "case`DustBoost`:return I({id:`mk0Boe`,message:`Chance to gain bonus {magicDust} Magic Dust when selling a pet`},{magicDust:rD});",
    "case`ProduceScaleBoost`:return I(cD,{sizeIcon:iD,sizeIncrease:F(wr[e].baseParameters.sizeIncrease,{signDisplay:`always`})});",
    "case`GoldGranter`:return uD(`Gold`);case`RainDance`:return uD(`Wet`);",
    "case`SeedFinderI`:return I(sD,{firstRarity:dD(Hr.SeedFinderI[0]),secondRarity:dD(Hr.SeedFinderI[1])});",
    "case`SeedFinderIII`:return I(oD,{rarity:dD(Hr.SeedFinderIII[0])});",
    "case`DawnCapture`:return I({id:`rcfg6g`,message:`Removes all Dawn mutations from nearby crops and converts them to {capsule} Dawn Capsules ({dawnlit} = 1, {dawncharged} = 2)`},{capsule:tD(`DawnCapsule`),dawnlit:eD(`Dawnlit`),dawncharged:eD(`Dawncharged`)});",
    "case`Thunderbloom`:return I({id:`ZzNhk4`,message:`Grows additional {crop} crops during Thunderstorms`},{crop:L(Mn(`ThunderCelestialShroomPlant`))});",
    "default:return e}}",
  ].join("");
  const DATA = [
    "var Hr={SeedFinderI:[F.Common,F.Uncommon],SeedFinderIII:[F.Mythic]};",
    "var P={ThunderCelestialShroomPlant:{name:`Thunder Shroom`,seed:{}}};",
  ].join("");
  // L'enum Rarity vit dans un autre chunk de données, sous forme de littéral.
  const RARITY = "var $={Common:`Common`,Uncommon:`Uncommon`,Rare:`Rare`,Legendary:`Legendary`,Mythic:`Mythical`};";

  const descriptions = extractAbilityDescriptions(UI, DATA, [DATA, RARITY]);

  it("reads a descriptor returned bare, without a helper around it", () => {
    assert.deepEqual(descriptions.ProduceEater, {
      description: "Chance to eat non-mutated crops for Coins",
      descriptionTokens: [],
    });
    assert.equal(descriptions.DoubleHatchII.description, "Chance to hatch an extra pet (fraternal siblings)");
    assert.equal(descriptions.Copycat.description, "Chance to copy ability of another active pet");
  });

  it("turns named tags into positional tokens", () => {
    assert.deepEqual(descriptions.CoinFinderII, {
      description: "Chance to find <0/> Coins",
      descriptionTokens: [{ type: "currency", id: "Coins" }],
    });
    assert.deepEqual(descriptions.DustBoost.descriptionTokens, [{ type: "currency", id: "MagicDust" }]);
    assert.deepEqual(descriptions.GoldGranter, {
      description: "Chance to grant <0/> mutation to a garden crop",
      descriptionTokens: [{ type: "mutation", id: "Gold" }],
    });
  });

  it("numbers tokens in the order they appear in the message", () => {
    assert.deepEqual(descriptions.DawnCapture, {
      description:
        "Removes all Dawn mutations from nearby crops and converts them to <0/> Dawn Capsules (<1/> = 1, <2/> = 2)",
      descriptionTokens: [
        { type: "item", id: "DawnCapsule" },
        { type: "mutation", id: "Dawnlit" },
        { type: "mutation", id: "Dawncharged" },
      ],
    });
    assert.deepEqual(descriptions.SeedFinderI, {
      description: "Finds <0/> or <1/> seeds",
      descriptionTokens: [
        { type: "rarity", id: "Common" },
        { type: "rarity", id: "Uncommon" },
      ],
    });
    assert.deepEqual(descriptions.SeedFinderIII.descriptionTokens, [{ type: "rarity", id: "Mythical" }]);
    assert.deepEqual(descriptions.Thunderbloom.descriptionTokens, [
      { type: "crop", id: "ThunderCelestialShroomPlant" },
    ]);
  });

  it("keeps number placeholders as values, next to the tags", () => {
    assert.deepEqual(descriptions.ProduceScaleBoost, {
      description: "Chance to increase size of garden crops by {sizeIncrease} <0/>",
      descriptionTokens: [{ type: "icon", id: "Size" }],
      descriptionValues: { sizeIncrease: { parameter: "sizeIncrease", format: { signDisplay: "always" } } },
    });
  });
});
