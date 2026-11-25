// src/core/extractors/enums.js

import { logger } from "../../logger/index.js";
import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { MUTATION_SIGNATURES } from "./mutations.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Définitions des enums canoniques à extraire.
 *
 * Chaque entrée décrit comment reconnaître l'enum parmi les IIFE
 * du bundle (forme: `function(e){return e.K=`v`,...,e}`) :
 * - requiredKeys : clés qui doivent toutes être présentes
 * - valueShape   : forme attendue des valeurs ("lowercase" | "pascalcase" | null)
 *                  utilisée pour départager des enums qui partagent les mêmes clés
 *                  (eligibleShops vs itemType par ex.)
 */
const ENUM_SHAPES = [
  {
    name: "rarity",
    requiredKeys: ["Common", "Uncommon", "Rare", "Legendary"],
  },
  {
    name: "currency",
    requiredKeys: ["Coins", "Credits", "MagicDust"],
  },
  {
    name: "eligibleShops",
    requiredKeys: ["Seed", "Egg", "Tool", "Decor", "Dawn"],
    valueShape: "lowercase",
  },
  {
    name: "itemType",
    requiredKeys: ["Seed", "Produce", "Plant", "Tool", "Pet", "Egg", "Decor"],
    valueShape: "pascalcase",
  },
  {
    name: "weather",
    requiredKeys: ["Rain", "Frost", "Thunderstorm", "Dawn", "AmberMoon"],
  },
];

const MUTATION_TIER_ANCHORS = ["Wet", "Chilled", "Frozen", "Thunderstruck"];

/**
 * Scanne le bundle pour tous les IIFE de forme:
 *   function(e){return e.A=`x`,e.B=`y`,...,e}
 * et retourne la liste des paires [key, value] (ordre préservé).
 */
function scanStringEnumIIFEs(mainJs) {
  const re =
    /function\(e\)\{return\s+(e\.[A-Za-z_][\w_]*=`[^`]+`(?:,e\.[A-Za-z_][\w_]*=`[^`]+`)+),e\}/g;
  const results = [];
  let m;
  while ((m = re.exec(mainJs)) !== null) {
    const pairs = [...m[1].matchAll(/e\.([A-Za-z_][\w_]*)=`([^`]*)`/g)].map(
      ([, k, v]) => [k, v]
    );
    if (pairs.length >= 2) results.push(pairs);
  }
  return results;
}

/**
 * Même recherche pour un enum écrit comme un simple littéral :
 *   $={Common:`Common`,Uncommon:`Uncommon`,...,Mythic:`Mythical`}
 * Forme prise par l'enum Rarity mi-novembre 2026, quand il a quitté les chunks
 * de données pour `rarity-*.js`. Un littéral plat de chaînes est une forme
 * bien plus banale qu'une IIFE : on ne le cherche qu'en repli, et seulement
 * dans une source qui porte toutes les clés demandées.
 */
function findStringEnumLiteral(js, requiredKeys) {
  if (!requiredKeys.every((key) => js.includes(key + ":`"))) return null;

  const re = /\{((?:[A-Za-z_]\w*:`[^`]+`,)+[A-Za-z_]\w*:`[^`]+`)\}/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const pairs = [...m[1].matchAll(/([A-Za-z_]\w*):`([^`]*)`/g)].map(([, k, v]) => [k, v]);
    const keys = pairs.map(([key]) => key);
    if (requiredKeys.every((required) => keys.includes(required))) return pairs;
  }
  return null;
}

/**
 * Retourne un enum du bundle sous forme { clé: valeur canonique }.
 * Utile quand le bundle référence l'enum par sa clé (`F.Mythic`) alors que le
 * reste de l'API expose la valeur (`"Mythical"`).
 */
export function findStringEnumMap(mainJs, requiredKeys) {
  const found =
    scanStringEnumIIFEs(mainJs).find((entries) => {
      const keys = entries.map(([key]) => key);
      return requiredKeys.every((required) => keys.includes(required));
    }) ?? findStringEnumLiteral(mainJs, requiredKeys);

  return found ? Object.fromEntries(found) : null;
}

function valueShapeMatches(values, shape) {
  if (!shape) return true;
  if (shape === "lowercase") return values.every((v) => /^[a-z]/.test(v));
  if (shape === "pascalcase") return values.every((v) => /^[A-Z]/.test(v));
  return true;
}

/**
 * Extrait l'ordre des mutations par tier.
 * Forme dans le bundle: `[\`Wet\`,\`Chilled\`,\`Frozen\`,\`Thunderstruck\`, ... ]`
 */
function extractMutationTierOrder(mainJs) {
  // Anchor sur les 4 premiers tiers stables; on capture le tableau complet.
  const re = new RegExp(
    `\\[(\`(?:${MUTATION_TIER_ANCHORS.join("|")})\`,?){4}[^\\]]*\\]`
  );
  const match = mainJs.match(re);
  if (!match) return null;
  return [...match[0].matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]);
}

// Groupe des mutations de croissance (Gold, Rainbow) : les seules qui ne sont
// pas des tiers météo.
const GROWTH_MUTATION_GROUP = "Growth";

/**
 * Repli pour l'ordre des tiers, déduit du catalogue des mutations.
 *
 * La 2198 a supprimé la liste écrite en dur : le jeu la reconstruit lui-même à
 * partir du catalogue (`X.filter(t=>Y[t].group===e)`). On fait de même — les
 * mutations hors groupe `Growth`, dans l'ordre du catalogue, ce qui redonne
 * exactement la liste que le jeu écrivait jusqu'à la 2184.
 */
function deriveMutationTierOrder(sources) {
  for (const src of sources) {
    let mutations;
    try {
      mutations = extractCategoryWithSandbox(src, "mutations", MUTATION_SIGNATURES, buildBaseSandbox).data;
    } catch {
      continue;
    }

    const tiers = Object.entries(mutations ?? {})
      .filter(([, m]) => typeof m?.group === "string" && m.group !== GROWTH_MUTATION_GROUP)
      .map(([id]) => id);
    if (tiers.length) return tiers;
  }
  return null;
}

/**
 * Extrait les enums canoniques du bundle.
 *
 * Retourne un dict { enumName: [orderedValues] }. Les clés sources de la forme
 * IIFE (ex. Mythic vs valeur Mythical) ne sont pas exposées — seule la liste
 * ordonnée des valeurs canoniques, qui correspond à ce que renvoient les
 * autres endpoints (`rarity: "Mythical"`, etc.).
 */
export function extractEnums(mainJs, _indexJs, _uiColorsSources, _abilityTextSource, weathersSource, dataSources) {
  const result = {};
  // Les enums weather et eligibleShops ont suivi le catalogue météo dans son
  // chunk (1280) : on scanne les deux quand ils diffèrent.
  // Depuis 1324 l'ordre des tiers de mutation vit dans un autre chunk de
  // données que celui des œufs : on scanne tous les chunks de données.
  const sources = [...new Set([mainJs, ...(dataSources ?? []), weathersSource].filter(Boolean))];
  const candidates = sources.flatMap((src) => scanStringEnumIIFEs(src));

  for (const shape of ENUM_SHAPES) {
    const matches = (entries) => {
      const keys = entries.map(([k]) => k);
      if (!shape.requiredKeys.every((rk) => keys.includes(rk))) return false;
      const values = entries.map(([, v]) => v);
      return valueShapeMatches(values, shape.valueShape);
    };
    // Repli : l'enum écrit comme un simple littéral (Rarity, mi-novembre 2026).
    const found =
      candidates.find(matches) ??
      sources
        .map((src) => findStringEnumLiteral(src, shape.requiredKeys))
        .find((entries) => entries && matches(entries));

    if (found) {
      result[shape.name] = found.map(([, v]) => v);
    } else {
      logger.warn({ enum: shape.name }, "Enum not found in bundle");
    }
  }

  const tierOrder =
    sources.map((src) => extractMutationTierOrder(src)).find(Boolean) ?? deriveMutationTierOrder(sources);
  if (tierOrder) result.mutationTierOrder = tierOrder;
  else logger.warn("Mutation tier order not found in bundle");

  return result;
}
