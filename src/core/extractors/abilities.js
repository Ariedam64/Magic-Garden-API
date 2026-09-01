// src/core/extractors/abilities.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { extractColorMapping, applyColors } from "../game/bundle/colors.js";
import { ABILITY_COLOR_NAMES, COLOR_MIN_HITS } from "../game/bundle/colorNames.js";
import { buildBaseSandbox } from "./sandbox.js";
import { extractAbilityDescriptions } from "./abilityText.js";
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
 *
 * Les couleurs vivent dans un bloc UI distinct des données (switch ou map selon
 * le build) qui a déjà changé de chunk et de forme plusieurs fois : la
 * localisation et le parsing sont délégués à `bundle/colors.js`, tolérant aux
 * deux dimensions. Voir ce module pour l'historique des formes rencontrées.
 *
 * Les descriptions viennent encore d'ailleurs (le chunk UI qui construit les
 * tooltips) et sont déléguées à `abilityText.js`. Leur absence laisse
 * `description` à null sans casser le reste.
 */
export function extractAbilities(mainJs, indexJs, uiColorsSources, abilityTextSource) {
  const abilities = extractCategoryWithSandbox(mainJs, "abilities", SIGNATURES, buildBaseSandbox).data;
  const celestial = extractCelestialAbilities(mainJs);
  Object.assign(abilities, celestial);

  const sources = [...(Array.isArray(uiColorsSources) ? uiColorsSources : [uiColorsSources]), indexJs, mainJs];
  const { colors, defaultColor } = extractColorMapping(sources, {
    names: ABILITY_COLOR_NAMES,
    minHits: COLOR_MIN_HITS,
    label: "abilities",
  });

  applyColors(abilities, colors, defaultColor?.solid ?? DEFAULT_ABILITY_COLOR, "abilities");

  const descriptions = extractAbilityDescriptions(abilityTextSource ?? indexJs ?? mainJs, mainJs);

  for (const [key, ability] of Object.entries(abilities)) {
    const text = descriptions[key];
    ability.description = text?.description ?? null;
    ability.descriptionTokens = text?.descriptionTokens ?? [];
  }

  return abilities;
}
