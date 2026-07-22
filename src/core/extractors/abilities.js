// src/core/extractors/abilities.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";
import { logger } from "../../logger/index.js";

/**
 * Signatures pour trouver les données des abilities dans le bundle.
 */
const SIGNATURES = ["baseProbability", "baseParameters:{", "trigger:`continuous`"];

/**
 * Signatures pour le bloc séparé des abilities célestes (MoonKisser, DawnKisser).
 * Ce bloc n'a ni `baseProbability` ni `trigger:`continuous``, donc il échappe
 * à l'extracteur principal — mais il est référencé par les plantes célestes
 * (`abilities:[MoonKisser]` / `abilities:[DawnKisser]`).
 */
const CELESTIAL_SIGNATURES = [
  "MoonKisser:{name:",
  "DawnKisser:{name:",
  "trigger:`weather`",
];

const DEFAULT_ABILITY_COLOR = "#969696";

// Noms d'abilities stables utilisés pour confirmer qu'on a trouvé le bon switch.
// Si au moins 3 sont présents dans le bloc, c'est le bon.
const COLOR_SWITCH_SIGNATURES = [
  "MoonKisser",
  "DawnKisser",
  "DoubleHarvest",
  "Copycat",
  "RainDance",
  "GoldGranter",
];
const MIN_SIGNATURE_HITS = 3;

/**
 * Cherche le switch statement contenant les case`...`:return`#...` dans une
 * source donnée. Retourne null si non trouvé (permet d'essayer plusieurs sources).
 *
 * Stratégie de recherche robuste :
 * - On cherche tous les switch contenant des case`...`:return`#...`
 * - On valide avec des noms d'abilities connus (signatures)
 * - Pas de dépendance sur le nom de variable ou la couleur default
 */
function findAbilityColorSwitch(source) {
  const switchRegex = /\bswitch\s*\([^)]+\)\s*\{/g;
  let switchMatch;

  while ((switchMatch = switchRegex.exec(source))) {
    // Extraire le corps du switch avec les braces équilibrées
    const braceStart = switchMatch.index + switchMatch[0].length - 1;
    let depth = 1;
    let end = braceStart + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}") depth--;
      end++;
    }
    const candidate = source.slice(braceStart + 1, end - 1);

    // Valider avec les signatures
    const hits = COLOR_SWITCH_SIGNATURES.filter((s) => candidate.includes(`\`${s}\``));
    if (hits.length >= MIN_SIGNATURE_HITS) {
      return candidate;
    }
  }

  return null;
}

/**
 * Extrait la map ability -> color depuis le switch statement du bundle.
 * Ce switch a changé d'emplacement plusieurs fois au fil des refontes de
 * build du jeu (main.js -> index.js -> un chunk dédié partagé avec les
 * couleurs de mutations). `uiColorsJs` est ce chunk, localisé dynamiquement
 * par `fetchMainBundle` via une recherche dans le graphe de chunks — c'est
 * la source la plus fiable. On garde indexJs/mainJs en repli si jamais le
 * jeu réintègre ce code ailleurs.
 */
function extractAbilityColors(mainJs, indexJs, uiColorsJs) {
  const switchBody =
    (uiColorsJs && findAbilityColorSwitch(uiColorsJs)) ||
    (indexJs && findAbilityColorSwitch(indexJs)) ||
    findAbilityColorSwitch(mainJs);

  if (!switchBody) {
    logger.warn("Ability color switch not found in bundle");
    return {};
  }

  // Parse chaque case`Name`: ... return`color`
  // Gère les cas groupés (plusieurs case avant un return)
  const colors = {};
  const tokens = [];
  const caseRegex = /case\s*`([A-Za-z_]+)`/g;
  const returnRegex = /return\s*`([^`]+)`/g;

  let m;
  while ((m = caseRegex.exec(switchBody))) {
    tokens.push({ type: "case", name: m[1], index: m.index });
  }
  while ((m = returnRegex.exec(switchBody))) {
    tokens.push({ type: "return", value: m[1], index: m.index });
  }

  tokens.sort((a, b) => a.index - b.index);

  const pending = [];
  for (const token of tokens) {
    if (token.type === "case") {
      pending.push(token.name);
    } else if (token.type === "return") {
      for (const name of pending) {
        colors[name] = token.value;
      }
      pending.length = 0;
    }
  }

  logger.debug({ count: Object.keys(colors).length }, "Ability colors extracted");
  return colors;
}

/**
 * Extrait les abilities célestes (MoonKisser, DawnKisser) définies à part.
 * Retourne {} si non trouvées — le manque doit pas casser l'extraction principale.
 */
function extractCelestialAbilities(mainJs) {
  try {
    return extractCategoryWithSandbox(
      mainJs,
      "celestial-abilities",
      CELESTIAL_SIGNATURES,
      buildBaseSandbox
    ).data;
  } catch (err) {
    logger.warn({ err: err.message }, "Celestial abilities block not found");
    return {};
  }
}

/**
 * Extrait les données des abilities du bundle.
 */
export function extractAbilities(mainJs, indexJs, uiColorsJs) {
  const abilities = extractCategoryWithSandbox(mainJs, "abilities", SIGNATURES, buildBaseSandbox).data;
  const celestial = extractCelestialAbilities(mainJs);
  Object.assign(abilities, celestial);

  const colors = extractAbilityColors(mainJs, indexJs, uiColorsJs);

  for (const [key, ability] of Object.entries(abilities)) {
    ability.color = colors[key] || DEFAULT_ABILITY_COLOR;
  }

  return abilities;
}
