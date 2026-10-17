// src/core/extractors/cosmetics.js

import {
  extractBalanced,
  extractBalancedBraces,
  extractCategoryWithSandbox,
  runObjectLiteral,
} from "../game/bundle/extractor.js";
import { makeGlobalSandboxProxy } from "../game/bundle/sandbox.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Catalogues de cosmétiques : accessoires de pets, tenues d'avatar et packs.
 *
 * Jusqu'ici l'API ne publiait que les **images** des cosmétiques
 * (`/assets/cosmetics`, lues dans le manifest). Le Haunt Event (2026-10-16) a
 * montré la limite : impossible de savoir qu'une tenue appartient à la drop
 * `halloween2026`, coûte 329 donuts, est vendue au Spooky Shop et disparaît le
 * 2026-11-10. Ces données vivent dans trois endroits différents du bundle :
 *
 * - accessoires de pets : un objet dans le chunk de données
 *   (`Wizard:{name:"Pet Wizard Hat",slotCategory:"hat",creditPrice:199,...}`) ;
 * - tenues d'avatar : un tableau dans `LocalizedTextContent`
 *   (`{id:"Top_Haunt.png",type:"Top",availability:"purchasable",cost:w.Donut}`),
 *   dont les prix sont une table nommée à part (`w={Donut:{currency,amount}}`) ;
 * - packs : un objet par pack dans `installPlayerSystems`
 *   (`{id:"Halloween2026",creditPrice:799,cosmeticFilename:...,items:[...]}`).
 *
 * Les deux derniers chunks sont repérés par le résolveur (`cosmeticsSources`).
 */

const PET_COSMETIC_SIGNATURES = ["slotCategory:", "creditPrice:"];

/**
 * Devise d'un prix. L'enum des devises est importé et donc inconnu du
 * sandbox : `we.Credits` y vaut `"Credits"`. On ramène au format de
 * `/data/enums` -> `currency` (`coins`, `credits`, `magicDust`).
 */
function normalizeCurrency(value) {
  if (typeof value !== "string" || !value) return value ?? null;
  return value[0].toLowerCase() + value.slice(1);
}

/** Sources à essayer : la source courante d'abord, puis les chunks dédiés. */
function candidateSources(source, context) {
  return [source, ...(context?.cosmeticsSources ?? [])].filter((s) => typeof s === "string");
}

/**
 * Accessoires de pets (chapeaux, cravates, badges), indexés par id.
 */
export function extractPetCosmetics(mainJs) {
  return extractCategoryWithSandbox(mainJs, "petCosmetics", PET_COSMETIC_SIGNATURES, buildBaseSandbox).data;
}

/**
 * Localise le tableau des tenues d'avatar : `X=[{id:"Top_...png",...}]`.
 */
function findAvatarCatalog(source) {
  for (const m of source.matchAll(/([A-Za-z_$][\w$]*)=\[\{id:[`"'][^`"']+\.png[`"']/g)) {
    const start = m.index + m[1].length + 1;
    const literal = extractBalanced(source, start, "[", "]");
    if (literal && literal.includes("availability:") && literal.includes("filename:")) return literal;
  }
  return null;
}

/**
 * Évalue les tables de prix référencées par `cost:<id>.<Tier>`.
 */
function resolveCostTables(source, literal, sandbox) {
  const ids = new Set([...literal.matchAll(/\bcost:([A-Za-z_$][\w$]*)\./g)].map((m) => m[1]));

  for (const id of ids) {
    const escaped = id.replace(/[$]/g, "\\$&");
    const m = source.match(new RegExp(`(?:^|[^A-Za-z0-9_$.])${escaped}=\\{`));
    if (!m) continue;

    const brace = m.index + m[0].length - 1;
    let table;
    try {
      table = runObjectLiteral(extractBalancedBraces(source, brace), makeGlobalSandboxProxy());
    } catch {
      continue;
    }

    const normalized = {};
    for (const [tier, price] of Object.entries(table ?? {})) {
      if (!price || typeof price !== "object") continue;
      normalized[tier] = { currency: normalizeCurrency(price.currency), amount: price.amount ?? null };
    }
    sandbox[id] = normalized;
  }
}

/**
 * Résout les constantes chaîne utilisées comme valeur (`{id:kt,filename:kt}`
 * avec `kt="Bottom_ToastShirt.png"` déclaré plus haut). Sans ça, le sandbox y
 * voit un enum vide et l'entrée perd son id.
 */
function resolveStringConstants(source, literal, sandbox) {
  const ids = new Set(
    [...literal.matchAll(/\b(?:id|filename|bodyArt):([A-Za-z_$][\w$]*)[,}]/g)].map((m) => m[1])
  );
  for (const id of ids) {
    const escaped = id.replace(/[$]/g, "\\$&");
    const m = source.match(new RegExp(`(?:^|[^A-Za-z0-9_$.])${escaped}=[\`"']([^\`"']+)[\`"']`));
    if (m) sandbox[id] = m[1];
  }
}

/**
 * Tenues d'avatar, indexées par id sans extension (`Top_Haunt`), comme
 * `/assets/cosmetics`.
 */
export function extractAvatarCosmetics(mainJs, _indexJs, _ui, _abilityText, _weathers, _sources, context) {
  for (const source of candidateSources(mainJs, context)) {
    const literal = findAvatarCatalog(source);
    if (!literal) continue;

    const sandbox = buildBaseSandbox(source, literal);
    resolveCostTables(source, literal, sandbox);
    resolveStringConstants(source, literal, sandbox);
    const list = runObjectLiteral(literal, sandbox);
    if (!Array.isArray(list) || !list.length) continue;

    const out = {};
    for (const entry of list) {
      if (!entry || typeof entry.id !== "string") continue;
      const id = entry.id.replace(/\.png$/i, "");
      out[id] = { ...entry, id };
    }
    return out;
  }

  throw new Error("[avatarCosmetics] not found (no outfit catalog in any chunk)");
}

/**
 * Localise les packs : `X={id:"...",creditPrice:...,cosmeticFilename:...,items:[...]}`.
 */
function findBundleOffers(source) {
  const literals = [];
  for (const m of source.matchAll(/([A-Za-z_$][\w$]*)=\{id:[`"'][^`"']+[`"'],creditPrice:/g)) {
    const start = m.index + m[1].length + 1;
    const literal = extractBalanced(source, start, "{", "}");
    if (literal && literal.includes("cosmeticFilename:") && literal.includes("items:[")) literals.push(literal);
  }
  return literals;
}

/**
 * Packs vendus en crédits (Spooky Bundle…), indexés par id.
 *
 * Le contenu est publié avec l'identifiant de l'objet sous `id`, quel que soit
 * le champ que le jeu utilise selon son type (`species`, `toolId`, `eggId`…).
 */
export function extractBundleOffers(mainJs, _indexJs, _ui, _abilityText, _weathers, _sources, context) {
  for (const source of candidateSources(mainJs, context)) {
    const literals = findBundleOffers(source);
    if (!literals.length) continue;

    const out = {};
    for (const literal of literals) {
      const offer = runObjectLiteral(literal, buildBaseSandbox(source, literal));
      if (!offer || typeof offer.id !== "string") continue;

      out[offer.id] = {
        ...offer,
        // `Array.from` : un `.map` sur le tableau de la vm resterait un tableau
        // de la vm (autre prototype `Array`), invisible pour `instanceof`.
        items: Array.from(offer.items ?? [], ({ itemType, quantity, ...rest }) => ({
          itemType,
          id: rest.species ?? rest.toolId ?? rest.eggId ?? rest.decorId ?? rest.petSpecies ?? Object.values(rest)[0] ?? null,
          quantity,
        })),
      };
    }
    if (Object.keys(out).length) return out;
  }

  throw new Error("[bundles] not found (no bundle offer in any chunk)");
}
