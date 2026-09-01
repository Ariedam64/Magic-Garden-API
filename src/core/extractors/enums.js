// src/core/extractors/enums.js

import { logger } from "../../logger/index.js";

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
 * Retourne un enum du bundle sous forme { clé: valeur canonique }.
 * Utile quand le bundle référence l'enum par sa clé (`F.Mythic`) alors que le
 * reste de l'API expose la valeur (`"Mythical"`).
 */
export function findStringEnumMap(mainJs, requiredKeys) {
  const found = scanStringEnumIIFEs(mainJs).find((entries) => {
    const keys = entries.map(([key]) => key);
    return requiredKeys.every((required) => keys.includes(required));
  });

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

/**
 * Extrait les enums canoniques du bundle.
 *
 * Retourne un dict { enumName: [orderedValues] }. Les clés sources de la forme
 * IIFE (ex. Mythic vs valeur Mythical) ne sont pas exposées — seule la liste
 * ordonnée des valeurs canoniques, qui correspond à ce que renvoient les
 * autres endpoints (`rarity: "Mythical"`, etc.).
 */
export function extractEnums(mainJs) {
  const result = {};
  const candidates = scanStringEnumIIFEs(mainJs);

  for (const shape of ENUM_SHAPES) {
    const found = candidates.find((entries) => {
      const keys = entries.map(([k]) => k);
      if (!shape.requiredKeys.every((rk) => keys.includes(rk))) return false;
      const values = entries.map(([, v]) => v);
      return valueShapeMatches(values, shape.valueShape);
    });

    if (found) {
      result[shape.name] = found.map(([, v]) => v);
    } else {
      logger.warn({ enum: shape.name }, "Enum not found in bundle");
    }
  }

  const tierOrder = extractMutationTierOrder(mainJs);
  if (tierOrder) result.mutationTierOrder = tierOrder;
  else logger.warn("Mutation tier order not found in bundle");

  return result;
}
