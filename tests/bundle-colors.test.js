// tests/bundle-colors.test.js
//
// Les couleurs d'abilities/mutations cassent à chaque refonte du build du jeu.
// Ce test fige toutes les formes de bundle rencontrées jusqu'ici (extraits
// réels, minifiés) : l'extracteur doit sortir les mêmes couleurs pour toutes,
// sans code spécifique à une forme.
//
// Quand le jeu changera encore de forme, ajouter ici l'extrait qui casse avant
// de toucher au parser — c'est le filet qui empêche une correction de casser
// les formes précédentes.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractColorMapping,
  definesColorsFor,
  resolveColorValue,
  parseObjectEntries,
  readExpression,
  parseGradient,
  applyColors,
} from "../src/core/game/bundle/colors.js";
import {
  ABILITY_COLOR_NAMES,
  MUTATION_COLOR_NAMES,
  COLOR_MIN_HITS,
} from "../src/core/game/bundle/colorNames.js";

// --- Formes historiques du bloc "abilities" -------------------------------

// Forme A : switch qui retourne directement une string (builds <= mi-2026).
const ABILITY_SWITCH_STRING = "var Lm=e=>{switch(e){case`MoonKisser`:return`#FAA623`;case`DawnKisser`:return`#A25CF2`;case`DoubleHarvest`:return`#0078B4`;case`Copycat`:return`#FF8C00`;case`GoldGranter`:return`#DCC846`;default:return`#969696`}};";

// Forme B : switch qui retourne { solid, gradient? }, avec des consts hoistées
// pour les dégradés (bundle v879, chunk de localisation).
const ABILITY_SWITCH_OBJECT = "var Fm={solid:`#DCC846`,gradient:{angleDegrees:135,colorStops:[{color:`#DCC846`,offset:0},{color:`#C8AF1E`,offset:1}]}},Lm=e=>{switch(e){case`MoonKisser`:return{solid:`#FAA623`};case`DawnKisser`:return{solid:`#A25CF2`};case`DoubleHarvest`:return{solid:`#0078B4`};case`Copycat`:return{solid:`#FF8C00`};case`GoldGranter`:return Fm;default:return{solid:`#969696`}}};";

// Forme C : hypothétique — map au lieu d'un switch, quotes doubles, clé `hex`.
// Sert à vérifier que le parser n'est couplé ni au conteneur ni à la syntaxe.
const ABILITY_MAP_DOUBLE_QUOTES = 'const Zx={MoonKisser:{hex:"#FAA623"},DawnKisser:{hex:"#A25CF2"},DoubleHarvest:{hex:"#0078B4"},Copycat:{hex:"#FF8C00"},GoldGranter:{hex:"#DCC846"}};';

const ABILITY_EXPECTED = {
  MoonKisser: "#FAA623",
  DawnKisser: "#A25CF2",
  DoubleHarvest: "#0078B4",
  Copycat: "#FF8C00",
  GoldGranter: "#DCC846",
};

for (const [label, source] of [
  ["switch + string (forme historique)", ABILITY_SWITCH_STRING],
  ["switch + {solid} + const hoistée (v879)", ABILITY_SWITCH_OBJECT],
  ["map + double quotes + clé hex", ABILITY_MAP_DOUBLE_QUOTES],
]) {
  test(`ability colors: ${label}`, () => {
    const { colors } = extractColorMapping([source], {
      names: ABILITY_COLOR_NAMES,
      minHits: COLOR_MIN_HITS,
    });

    for (const [name, expected] of Object.entries(ABILITY_EXPECTED)) {
      assert.equal(colors[name]?.solid, expected, `${name} dans "${label}"`);
    }
  });
}

test("ability colors: la couleur par défaut est lue dans le bundle", () => {
  const { defaultColor } = extractColorMapping([ABILITY_SWITCH_OBJECT], {
    names: ABILITY_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  assert.equal(defaultColor?.solid, "#969696");
});

test("ability colors: le dégradé est conservé à côté du solide", () => {
  const { colors } = extractColorMapping([ABILITY_SWITCH_OBJECT], {
    names: ABILITY_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  assert.equal(colors.GoldGranter.solid, "#DCC846");
  assert.match(colors.GoldGranter.gradient, /colorStops/);
  assert.equal(colors.MoonKisser.gradient, null);
});

test("ability colors: les case groupés partagent la même couleur", () => {
  const source = "e=>{switch(e){case`SeedFinderI`:case`SeedFinderII`:case`MoonKisser`:return{solid:`#A86626`};case`Copycat`:return{solid:`#FF8C00`};case`DoubleHarvest`:return{solid:`#0078B4`}}}";
  const { colors } = extractColorMapping([source], {
    names: [...ABILITY_COLOR_NAMES, "SeedFinderI", "SeedFinderII"],
    minHits: COLOR_MIN_HITS,
  });
  assert.equal(colors.SeedFinderI.solid, "#A86626");
  assert.equal(colors.SeedFinderII.solid, "#A86626");
  assert.equal(colors.MoonKisser.solid, "#A86626");
});

// --- Formes historiques du bloc "mutations" -------------------------------

const MUTATION_MAP_STRING = "var Nm={Gold:`rgb(235, 200, 0)`,Rainbow:`#D02128`,Wet:`rgba(95, 255, 255, 1)`,Chilled:`rgba(180, 230, 255, 1)`,Frozen:`rgb(185, 200, 255)`,Thunderstruck:`rgb(255, 247, 0)`,Dawnlit:`rgb(245, 155, 225)`,Ambershine:`rgb(255, 180, 120)`};";

const MUTATION_MAP_OBJECT = "var Nm={Gold:{solid:`rgb(235, 200, 0)`},Rainbow:{solid:`#D02128`,gradient:{angleDegrees:135,colorStops:[{color:`#D02128`,offset:0},{color:`#AE53B0`,offset:1}]}},Wet:{solid:`rgba(95, 255, 255, 1)`},Chilled:{solid:`rgba(180, 230, 255, 1)`},Frozen:{solid:`rgb(185, 200, 255)`},Thunderstruck:{solid:`rgb(255, 247, 0)`},Dawnlit:{solid:`rgb(245, 155, 225)`},Ambershine:{solid:`rgb(255, 180, 120)`}};";

const MUTATION_EXPECTED = {
  Gold: "rgb(235, 200, 0)",
  Rainbow: "#D02128",
  Wet: "rgba(95, 255, 255, 1)",
  Frozen: "rgb(185, 200, 255)",
  Ambershine: "rgb(255, 180, 120)",
};

for (const [label, source] of [
  ["map de strings (forme historique)", MUTATION_MAP_STRING],
  ["map de {solid,gradient} (v879)", MUTATION_MAP_OBJECT],
]) {
  test(`mutation colors: ${label}`, () => {
    const { colors } = extractColorMapping([source], {
      names: MUTATION_COLOR_NAMES,
      minHits: COLOR_MIN_HITS,
    });

    for (const [name, expected] of Object.entries(MUTATION_EXPECTED)) {
      assert.equal(colors[name]?.solid, expected, `${name} dans "${label}"`);
    }
  });
}

// --- Dégradés --------------------------------------------------------------
//
// Rainbow / GoldGranter / RainbowGranter sont multicolores dans le jeu. Le
// parser gardait déjà le dégradé mais `applyColors` ne posait que le solide :
// l'API rendait Rainbow en rouge plat. On fige donc le trajet complet, du
// bundle jusqu'à l'entité exposée.

test("parseGradient normalise l'object literal du bundle", () => {
  // Offsets écrits en fractions et quotes en backticks : ce n'est pas du JSON.
  const gradient = parseGradient(
    "{angleDegrees:135,colorStops:[{color:`#D02128`,offset:0},{color:`#FC6D30`,offset:1/7},{color:`#AE53B0`,offset:1}]}"
  );
  assert.equal(gradient.angleDegrees, 135);
  assert.equal(gradient.colorStops.length, 3);
  assert.deepEqual(gradient.colorStops[0], { color: "#D02128", offset: 0 });
  assert.equal(gradient.colorStops[1].offset, 1 / 7);
});

test("parseGradient refuse ce qui n'est pas un dégradé exploitable", () => {
  assert.equal(parseGradient(null), null);
  assert.equal(parseGradient("{angleDegrees:135}"), null);
  // Référence à une variable minifiée : contexte vide => pas de couleur inventée.
  assert.equal(parseGradient("{colorStops:Fm}"), null);
  // Stops non colorés : on ne les expose pas.
  assert.equal(parseGradient("{colorStops:[{color:`Amberlit`,offset:0}]}"), null);
});

test("applyColors expose le dégradé à côté de la couleur plate", () => {
  const { colors, defaultColor } = extractColorMapping([MUTATION_MAP_OBJECT], {
    names: MUTATION_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  const entities = { Rainbow: { name: "Rainbow" }, Gold: { name: "Gold" }, Inconnue: { name: "?" } };
  applyColors(entities, colors, defaultColor?.solid ?? "#969696", "test-mutations");

  assert.equal(entities.Rainbow.color, "#D02128");
  assert.equal(entities.Rainbow.gradient.angleDegrees, 135);
  assert.deepEqual(entities.Rainbow.gradient.colorStops, [
    { color: "#D02128", offset: 0 },
    { color: "#AE53B0", offset: 1 },
  ]);
  // Une entité monochrome ne porte pas de clé `gradient` vide.
  assert.equal(entities.Gold.color, "rgb(235, 200, 0)");
  assert.equal("gradient" in entities.Gold, false);
  assert.equal(entities.Inconnue.color, "#969696");
  assert.equal("gradient" in entities.Inconnue, false);
});

// --- Robustesse ------------------------------------------------------------

test("le bloc de données n'est pas confondu avec un bloc de couleurs", () => {
  // Extrait réel du chunk de données : mêmes clés, aucune couleur.
  const dataChunk = "var q={Gold:{name:`Gold`,baseChance:.01,coinMultiplier:20},Rainbow:{name:`Rainbow`,baseChance:.001,coinMultiplier:50},Wet:{name:`Wet`,baseChance:.05,coinMultiplier:2},Ambershine:{name:`Amberlit`,baseChance:.05,coinMultiplier:8}};";
  assert.equal(definesColorsFor(dataChunk, MUTATION_COLOR_NAMES, COLOR_MIN_HITS), false);
});

test("le chunk de couleurs est bien reconnu, quelle que soit sa forme", () => {
  for (const source of [MUTATION_MAP_STRING, MUTATION_MAP_OBJECT]) {
    assert.equal(definesColorsFor(source, MUTATION_COLOR_NAMES, COLOR_MIN_HITS), true);
  }
  for (const source of [ABILITY_SWITCH_STRING, ABILITY_SWITCH_OBJECT, ABILITY_MAP_DOUBLE_QUOTES]) {
    assert.equal(definesColorsFor(source, ABILITY_COLOR_NAMES, COLOR_MIN_HITS), true);
  }
});

test("les accolades des messages i18n ne piègent pas la remontée vers la map", () => {
  // Le chunk de localisation mélange messages traduits et couleurs : les `{}`
  // dans les strings ne doivent pas être comptés comme des objets.
  const source = "var t={MoonKisser:{id:`XO6PR5`,message:`Replace {sourceMutation} with {targetMutation}`}},Nm={Gold:{solid:`rgb(235, 200, 0)`},Rainbow:{solid:`#D02128`},Wet:{solid:`rgba(95, 255, 255, 1)`},Frozen:{solid:`rgb(185, 200, 255)`}};";
  const { colors } = extractColorMapping([source], {
    names: MUTATION_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  assert.equal(colors.Gold.solid, "rgb(235, 200, 0)");
  assert.equal(colors.Frozen.solid, "rgb(185, 200, 255)");
});

test("les identifiants hoistés sont résolus à travers les sources", () => {
  const declaring = "var Fm={solid:`#DCC846`};";
  const using = "e=>{switch(e){case`GoldGranter`:return Fm;case`Copycat`:return{solid:`#FF8C00`};case`MoonKisser`:return{solid:`#FAA623`}}}";
  const { colors } = extractColorMapping([using, declaring], {
    names: ABILITY_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  assert.equal(colors.GoldGranter.solid, "#DCC846");
});

test("aucun bloc trouvé => map vide, pas d'exception", () => {
  const { colors, defaultColor } = extractColorMapping([null, "var a=1;"], {
    names: ABILITY_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
  });
  assert.deepEqual(colors, {});
  assert.equal(defaultColor, null);
});

// --- Primitives ------------------------------------------------------------

test("resolveColorValue accepte les formes de valeur connues", () => {
  assert.equal(resolveColorValue("`#FAA623`").solid, "#FAA623");
  assert.equal(resolveColorValue('"rgb(1, 2, 3)"').solid, "rgb(1, 2, 3)");
  assert.equal(resolveColorValue("{solid:`#FAA623`}").solid, "#FAA623");
  assert.equal(resolveColorValue("{hex:`#FAA623`}").solid, "#FAA623");
  // Clé inconnue : on retombe sur le premier littéral de couleur.
  assert.equal(resolveColorValue("{teinte:`#FAA623`}").solid, "#FAA623");
  // Valeur non colorée : rien plutôt qu'une couleur inventée.
  assert.equal(resolveColorValue("`Amberlit`"), null);
  assert.equal(resolveColorValue("42"), null);
});

test("readExpression s'arrête au bon endroit", () => {
  assert.equal(readExpression("{a:1},b", 0).text, "{a:1}");
  assert.equal(readExpression("`a,b`,c", 0).text, "`a,b`");
  assert.equal(readExpression("Fm;next", 0).text, "Fm");
});

test("parseObjectEntries ignore shorthand et clés exotiques", () => {
  const entries = parseObjectEntries("{a:`x`,b,[c]:`y`,'d':`z`}");
  assert.deepEqual(entries, [
    ["a", "`x`"],
    ["d", "`z`"],
  ]);
});
