// src/core/game/bundle/colorNames.js
//
// Noms de domaine utilisés pour localiser les blocs de couleurs dans le bundle.
//
// Ce sont les seules constantes couplées au jeu : des identifiants stables
// (ils survivent à la minification et aux refontes de build, contrairement aux
// noms de variables ou à la syntaxe des valeurs). Partagés entre le résolveur
// de chunks et les extracteurs pour qu'ils cherchent exactement la même chose.
//
// Si le jeu renomme une ability/mutation, il suffit d'ajouter le nouveau nom :
// on n'exige que COLOR_MIN_HITS correspondances, la liste est volontairement
// plus longue que nécessaire pour tolérer les renommages.

export const ABILITY_COLOR_NAMES = [
  "MoonKisser",
  "DawnKisser",
  "DoubleHarvest",
  "DoubleHatch",
  "Copycat",
  "RainDance",
  "GoldGranter",
  "RainbowGranter",
  "SnowGranter",
  "FrostGranter",
  "ProduceEater",
  "ProduceRefund",
];

export const MUTATION_COLOR_NAMES = [
  "Gold",
  "Rainbow",
  "Wet",
  "Chilled",
  "Frozen",
  "Thunderstruck",
  "Dawnlit",
  "Ambershine",
  "Dawncharged",
  "Ambercharged",
];

/** Nombre de noms connus à retrouver pour valider un bloc de couleurs. */
export const COLOR_MIN_HITS = 3;
