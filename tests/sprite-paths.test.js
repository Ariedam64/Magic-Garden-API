// tests/sprite-paths.test.js
//
// Le jeu range ses sprites dans des champs qui changent de nom et de
// profondeur d'une catégorie à l'autre, et il en ajoute à chaque mise à jour.
// La refonte de février 2026 (`tileRef` → paths directs) n'avait gardé que le
// `sprite` racine : les 50 décors, leurs variantes de rotation, leurs upgrades
// et les tuiles d'activation des célestes ont perdu leur URL en silence, sans
// qu'aucun test ne s'en aperçoive.
//
// Ce test fige donc les formes réelles rencontrées dans les données du jeu.
// Quand une mise à jour en apporte une nouvelle, l'ajouter ici d'abord — le
// parcours doit rester générique, jamais une liste de champs à rallonge.

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  resolveSpritePath,
  resolveSpritePathsDeep,
} from "../src/utils/spritePathResolver.js";
import {
  transformDataWithSprites,
  transformWeathersWithSprites,
} from "../src/services/dataTransformer.js";

const V = "1019";

/** URL attendue pour un path d'atlas donné. */
const url = (category, name) =>
  resolveSpritePath(`sprite/${category}/${name}`, { version: V });

// --- Le parcours générique -------------------------------------------------

test("resolveSpritePathsDeep résout quel que soit le nom du champ", () => {
  const out = resolveSpritePathsDeep(
    {
      sprite: "sprite/plant/Carrot",
      immatureSprite: "sprite/plant/BabyCarrot",
      activationSprite: "sprite/animation/ThunderActivationTile",
    },
    { version: V }
  );

  assert.equal(out.sprite, url("plant", "Carrot"));
  assert.equal(out.immatureSprite, url("plant", "BabyCarrot"));
  assert.equal(out.activationSprite, url("animation", "ThunderActivationTile"));
});

test("resolveSpritePathsDeep descend dans les objets et les tableaux", () => {
  const out = resolveSpritePathsDeep(
    {
      rotationVariants: {
        90: { sprite: "sprite/decor/HayBaleSideways", flipH: true },
      },
      upgrades: [
        { cost: { creditPrice: 399 }, sprite: "sprite/decor/DecorShed_1" },
        { cost: { creditPrice: 449 } },
      ],
      baseParameters: { activationSprite: "sprite/animation/MoonCelestialActivationTile" },
    },
    { version: V }
  );

  assert.equal(out.rotationVariants["90"].sprite, url("decor", "HayBaleSideways"));
  assert.equal(out.rotationVariants["90"].flipH, true);
  assert.equal(out.upgrades[0].sprite, url("decor", "DecorShed_1"));
  assert.equal(out.upgrades[1].sprite, undefined);
  assert.equal(
    out.baseParameters.activationSprite,
    url("animation", "MoonCelestialActivationTile")
  );
});

test("resolveSpritePathsDeep laisse intact tout ce qui n'est pas un path", () => {
  const input = {
    name: "Hay Bale",
    coinPrice: 6000,
    coinPriceNull: null,
    eligibleShops: ["Decor"],
    notAPath: "sprites/decor/HayBale",
    tile: "tile/TallGrass_A",
  };

  assert.deepEqual(resolveSpritePathsDeep(input, { version: V }), input);
});

test("resolveSpritePathsDeep republie le path brut plutôt qu'un null quand il ne sait pas le lire", () => {
  const out = resolveSpritePathsDeep({ sprite: "sprite/Orphan" }, { version: V });
  assert.equal(out.sprite, "sprite/Orphan");
});

test("resolveSpritePathsDeep préserve les Date au lieu de les aplatir", () => {
  // `expiryDate` des graines saisonnières : recopié champ par champ, il
  // deviendrait `{}` et la date disparaîtrait du JSON servi.
  const expiryDate = new Date("2026-09-01T00:00:00.000Z");
  const out = resolveSpritePathsDeep(
    { seed: { sprite: "sprite/seed/Clover", expiryDate } },
    { version: V }
  );

  assert.equal(out.seed.expiryDate instanceof Date, true);
  assert.equal(JSON.parse(JSON.stringify(out)).seed.expiryDate, "2026-09-01T00:00:00.000Z");
  assert.equal(out.seed.sprite, url("seed", "Clover"));
});

test("resolveSpritePathsDeep traite les objets venus du vm de l'extracteur", () => {
  // Les données du jeu sont évaluées dans un `vm` : leurs objets et leurs Date
  // appartiennent à un autre realm. Un tri par prototype ou par `instanceof`
  // les prendrait tous pour des objets exotiques et ne résoudrait plus rien.
  const sandboxed = vm.runInNewContext(`({
    seed: { sprite: "sprite/seed/Clover", expiryDate: new Date("2026-09-01T00:00:00.000Z") },
  })`);

  const out = resolveSpritePathsDeep(sandboxed, { version: V });

  assert.equal(out.seed.sprite, url("seed", "Clover"));
  assert.equal(
    JSON.parse(JSON.stringify(out)).seed.expiryDate,
    "2026-09-01T00:00:00.000Z"
  );
});

test("resolveSpritePathsDeep ne mute pas son entrée", () => {
  const input = { sprite: "sprite/plant/Carrot" };
  resolveSpritePathsDeep(input, { version: V });
  assert.equal(input.sprite, "sprite/plant/Carrot");
});

test("resolveSpritePathsDeep garde `art` brut", () => {
  const out = resolveSpritePathsDeep({ art: "sprite/decor/SmallRock" }, { version: V });
  assert.equal(out.art, "sprite/decor/SmallRock");
});

// --- Les décors ------------------------------------------------------------

test("un décor fixe reçoit un `sprite` dérivé de `art`, qui reste brut", () => {
  const out = transformDataWithSprites(
    { SmallRock: { art: "sprite/decor/SmallRock", name: "Small Garden Rock", coinPrice: 1000 } },
    "decor",
    { spriteVersion: V }
  );

  assert.equal(out.SmallRock.sprite, url("decor", "SmallRock"));
  assert.equal(out.SmallRock.art, "sprite/decor/SmallRock");
  assert.equal(out.SmallRock.name, "Small Garden Rock");
});

test("un décor Rive tire son `sprite` de l'artboard, dont la casse diffère de la clé", () => {
  const out = transformDataWithSprites(
    { StoneBirdbath: { art: { artboardName: "StoneBirdBath" }, name: "Stone Bird Bath" } },
    "decor",
    { spriteVersion: V }
  );

  // L'atlas range le PNG sous `StoneBirdBath`, pas sous l'identifiant de données.
  assert.equal(out.StoneBirdbath.sprite, url("decor", "StoneBirdBath"));
  assert.deepEqual(out.StoneBirdbath.art, { artboardName: "StoneBirdBath" });
});

test("les variantes de rotation et les upgrades d'un décor sont résolues", () => {
  const out = transformDataWithSprites(
    {
      HayBale: {
        art: "sprite/decor/HayBale",
        rotationVariants: {
          90: { sprite: "sprite/decor/HayBaleSideways", flipH: true },
          180: { sprite: "sprite/decor/HayBale", flipH: true },
        },
      },
    },
    "decor",
    { spriteVersion: V }
  );

  assert.equal(out.HayBale.rotationVariants["90"].sprite, url("decor", "HayBaleSideways"));
  assert.equal(out.HayBale.rotationVariants["180"].sprite, url("decor", "HayBale"));
});

test("un décor sans art exploitable n'invente pas de sprite", () => {
  const out = transformDataWithSprites(
    { Mystery: { name: "Mystery", art: { foo: "bar" } } },
    "decor",
    { spriteVersion: V }
  );

  assert.equal(out.Mystery.sprite, undefined);
});

test("`sprite` est le premier champ d'un décor, comme dans les autres catégories", () => {
  const out = transformDataWithSprites(
    { SmallRock: { art: "sprite/decor/SmallRock", name: "Small Garden Rock" } },
    "decor",
    { spriteVersion: V }
  );

  assert.equal(Object.keys(out.SmallRock)[0], "sprite");
});

// --- Non-régression sur les catégories qui marchaient ----------------------

test("le `sprite` racine des autres catégories est inchangé", () => {
  const out = transformDataWithSprites(
    { WateringCan: { sprite: "sprite/item/WateringCan", name: "Watering Can" } },
    "items",
    { spriteVersion: V }
  );

  assert.equal(out.WateringCan.sprite, url("item", "WateringCan"));
});

test("le repli des mutations sans sprite explicite tient toujours", () => {
  const out = transformDataWithSprites(
    { Gold: { name: "Gold", coinMultiplier: 25 } },
    "mutations",
    { spriteVersion: V }
  );

  assert.equal(out.Gold.sprite, url("ui", "MutationGold"));
});

test("la météo troque toujours iconSpriteKey contre sprite", () => {
  const out = transformWeathersWithSprites(
    { Rain: { name: "Rain", iconSpriteKey: "sprite/ui/RainIcon" } },
    { spriteVersion: V }
  );

  assert.equal(out.Rain.sprite, url("ui", "RainIcon"));
  assert.equal("iconSpriteKey" in out.Rain, false);
  // Le Sunny par défaut est toujours ajouté quand le jeu ne le liste pas.
  assert.equal(out.Sunny.sprite, url("ui", "SunnyIcon"));
});
