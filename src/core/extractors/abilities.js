// src/core/extractors/abilities.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";
import { logger } from "../../logger/index.js";

/**
 * Signatures pour trouver les données des abilities dans le bundle.
 */
const SIGNATURES = ["baseProbability", "baseParameters:{", "trigger:`continuous`"];

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
 * Extrait la map ability -> color depuis le switch statement du bundle.
 *
 * Stratégie de recherche robuste :
 * - On cherche tous les switch contenant des case`...`:return`#...`
 * - On valide avec des noms d'abilities connus (signatures)
 * - Pas de dépendance sur le nom de variable ou la couleur default
 */
function extractAbilityColors(mainJs) {
  const colors = {};

  // Cherche tous les switch statements contenant des case avec template literals
  const switchRegex = /\bswitch\s*\([^)]+\)\s*\{/g;
  let switchMatch;
  let switchBody = null;

  while ((switchMatch = switchRegex.exec(mainJs))) {
    // Extraire le corps du switch avec les braces équilibrées
    const braceStart = switchMatch.index + switchMatch[0].length - 1;
    let depth = 1;
    let end = braceStart + 1;
    while (end < mainJs.length && depth > 0) {
      if (mainJs[end] === "{") depth++;
      else if (mainJs[end] === "}") depth--;
      end++;
    }
    const candidate = mainJs.slice(braceStart + 1, end - 1);

    // Valider avec les signatures
    const hits = COLOR_SWITCH_SIGNATURES.filter((s) => candidate.includes(`\`${s}\``));
    if (hits.length >= MIN_SIGNATURE_HITS) {
      switchBody = candidate;
      break;
    }
  }

  if (!switchBody) {
    logger.warn("Ability color switch not found in bundle");
    return colors;
  }

  // Parse chaque case`Name`: ... return`color`
  // Gère les cas groupés (plusieurs case avant un return)
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
 * Extrait les données des abilities du bundle.
 */
export function extractAbilities(mainJs) {
  const abilities = extractCategoryWithSandbox(mainJs, "abilities", SIGNATURES, buildBaseSandbox).data;
  const colors = extractAbilityColors(mainJs);

  for (const [key, ability] of Object.entries(abilities)) {
    ability.color = colors[key] || DEFAULT_ABILITY_COLOR;
  }

  return abilities;
}
