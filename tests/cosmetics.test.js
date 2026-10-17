// tests/cosmetics.test.js
//
// Catalogues de cosmétiques (Haunt Event, 1598). Extraits réduits mais fidèles
// à la forme réelle de 1608 : accessoires de pets dans le chunk de données,
// tenues dans `LocalizedTextContent`, packs dans `installPlayerSystems`.

import test from "node:test";
import assert from "node:assert/strict";

import { setLinkedChunks } from "../src/core/extractors/sandbox.js";
import {
  extractPetCosmetics,
  extractAvatarCosmetics,
  extractBundleOffers,
} from "../src/core/extractors/cosmetics.js";

const DATES = {
  url: "https://x/assets/expiryDates-D0M2yI8F.js",
  content: "var i=new Date(`2026-11-10T00:00:00.000Z`);export{i as t};",
};

const DATA =
  'import{t as Ie}from"./expiryDates-D0M2yI8F.js";' +
  "var xl={Ballcap:{name:`Ball Cap`,slotCategory:`hat`,sprite:D.PetCosmetic.Ballcap,creditPrice:49,rarity:L.Common}," +
  "Witch:{name:`Pet Witch Hat`,slotCategory:`hat`,sprite:D.PetCosmetic.Witch,creditPrice:199,soldAtSpookyShop:!0,expiryDate:Ie,rarity:L.Rare}},Sl=Object.keys(xl);";

const OUTFITS =
  'import{t as h}from"./expiryDates-D0M2yI8F.js";' +
  "var Ot=[`outfitStationLaunch`,`halloween2026`],kt=`Bottom_ToastShirt.png`," +
  "w={CoinsD:{currency:we.Coins,amount:1e3},DustShowcase:{currency:we.MagicDust,amount:25e3},Donut:{currency:we.Credits,amount:329}}," +
  "At=[{id:`Top_DefaultGray.png`,filename:`Top_DefaultGray.png`,type:`Top`,availability:`default`,displayName:`Default`}," +
  "{id:kt,filename:kt,type:`Bottom`,availability:`claimable`,displayName:`Toast Shirt`,drop:`outfitStationLaunch`}," +
  "{id:`Top_Haunt.png`,filename:`Top_Haunt.png`,type:`Top`,availability:`purchasable`,displayName:`Haunt`,drop:`halloween2026`," +
  "bodyArt:`Top_HauntBody.png`,cost:w.Donut,soldAtSpookyShop:!0,expiryDate:h}],jt=At.filter(e=>e.availability===`claimable`);";

const BUNDLES =
  'import{r as wt,t as Tt}from"./expiryDates-D0M2yI8F.js";' +
  "var S8={id:`Halloween2026`,creditPrice:799,cosmeticFilename:`Top_GothicTopHat.png`,cosmeticType:`Top`,expiryDate:Tt," +
  "items:[{itemType:E.Tool,toolId:`CarvingKnife`,quantity:5},{itemType:E.Seed,species:`Pumpkin`,quantity:5},{itemType:E.Egg,eggId:`SpookyEgg`,quantity:1}]};";

const context = { cosmeticsSources: [OUTFITS, BUNDLES] };

test.before(() => setLinkedChunks([DATES]));
test.after(() => setLinkedChunks([]));

test("pet cosmetics carry their slot, price, sprite and Spooky Shop expiry", () => {
  const pets = extractPetCosmetics(DATA);
  assert.deepEqual(Object.keys(pets), ["Ballcap", "Witch"]);
  assert.equal(pets.Witch.slotCategory, "hat");
  assert.equal(pets.Witch.sprite, "sprite/pet-cosmetic/Witch");
  assert.equal(pets.Witch.soldAtSpookyShop, true);
  assert.equal(pets.Witch.expiryDate.toISOString(), "2026-11-10T00:00:00.000Z");
});

test("outfits resolve their price table, currency and drop", () => {
  const outfits = extractAvatarCosmetics(DATA, null, null, null, null, null, context);
  assert.deepEqual(outfits.Top_Haunt.cost, { currency: "credits", amount: 329 });
  assert.equal(outfits.Top_Haunt.drop, "halloween2026");
  assert.equal(outfits.Top_Haunt.expiryDate.toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(outfits.Top_DefaultGray.cost, undefined);
});

test("an outfit declared through a constant keeps its id", () => {
  const outfits = extractAvatarCosmetics(DATA, null, null, null, null, null, context);
  assert.equal(outfits.Bottom_ToastShirt?.filename, "Bottom_ToastShirt.png");
});

test("bundles list their content under a uniform id", () => {
  const bundles = extractBundleOffers(DATA, null, null, null, null, null, context);
  const offer = bundles.Halloween2026;
  assert.equal(offer.creditPrice, 799);
  assert.equal(offer.expiryDate.toISOString(), "2026-11-10T00:00:00.000Z");
  assert.deepEqual(offer.items, [
    { itemType: "Tool", id: "CarvingKnife", quantity: 5 },
    { itemType: "Seed", id: "Pumpkin", quantity: 5 },
    { itemType: "Egg", id: "SpookyEgg", quantity: 1 },
  ]);
});

test("a missing catalog fails loudly instead of returning nothing", () => {
  assert.throws(() => extractBundleOffers(DATA, null, null, null, null, null, { cosmeticsSources: [] }), /not found/);
});
