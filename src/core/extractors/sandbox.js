// src/core/extractors/sandbox.js

import vm from "node:vm";

import {
  makeEnumProxy,
  makeGlobalSandboxProxy,
  tryExtractStringEnum,
} from "../game/bundle/sandbox.js";
import { extractSpriteMapping } from "../game/bundle/spriteMapping.js";

/**
 * Applique l'enum Rarity au sandbox.
 */
export function applyRarityEnum(mainJs, objLiteral, sandbox) {
  const rarityId = objLiteral.match(/rarity:([A-Za-z_$][\w$]*)\./)?.[1];
  if (!rarityId) return;

  sandbox[rarityId] =
    tryExtractStringEnum(mainJs, rarityId, ["Common", "Uncommon", "Rare"]) ?? makeEnumProxy();
}

/**
 * Applique les enums Weather au sandbox.
 */
export function applyWeatherEnums(mainJs, objLiteral, sandbox) {
  const ids = new Set(
    [
      ...objLiteral.matchAll(
        /\b(?:requiredWeather|weather|desiredWeather|triggeredWeather|weatherRequirement):([A-Za-z_$][\w$]*)\./g
      ),
    ].map((m) => m[1])
  );

  for (const wid of ids) {
    sandbox[wid] =
      tryExtractStringEnum(mainJs, wid, ["Rain", "Frost", "Dawn"]) ?? makeEnumProxy();
  }
}

/**
 * Applique l'enum HarvestType au sandbox.
 */
export function applyHarvestTypeEnum(mainJs, objLiteral, sandbox) {
  const harvestId = objLiteral.match(/harvestType:([A-Za-z_$][\w$]*)\./)?.[1];
  if (!harvestId) return;

  sandbox[harvestId] =
    tryExtractStringEnum(mainJs, harvestId, ["Single", "Multiple"]) ?? makeEnumProxy();
}

/**
 * Détecte et injecte l'objet sprite mapping dans le sandbox.
 * Cherche les patterns sprite:IDENTIFIER.(Seed|Plant|...) dans le literal
 * pour détecter dynamiquement le nom de variable (qui change après minification).
 */
export function applySpriteMapping(mainJs, objLiteral, sandbox) {
  const match = objLiteral.match(
    /\b(?:sprite|immatureSprite|topmostLayerSprite|iconSpriteKey|activationSprite):([A-Za-z_$][\w$]*)\.(?:Seed|Plant|TallPlant|Pet|Decor|Item|Mutation|MutationOverlay|Animation|Ui)\./
  );
  if (!match) return;

  const result = extractSpriteMapping(mainJs);
  if (result?.mapping) {
    sandbox[match[1]] = result.mapping;
  }
}

/**
 * Résout les références à des constantes Date externes au literal.
 *
 * Le bundle définit `varName=new Date(`ISO`)` puis utilise `expiryDate:varName`
 * dans les entrées d'items/eggs/decors/seeds. Sans pré-résolution, le proxy
 * sandbox renvoie un enum proxy vide -> sérialisation en `{}`.
 */
export function applyDateConstants(mainJs, objLiteral, sandbox) {
  const ids = new Set(
    [...objLiteral.matchAll(/\bexpiryDate:([A-Za-z_$][\w$]*)\b/g)]
      .map((m) => m[1])
      .filter((id) => id !== "null" && id !== "undefined")
  );

  for (const id of ids) {
    // Cherche `<id>=new Date(`...`)` ailleurs dans le bundle.
    // L'identifiant peut commencer par _ ou $, donc on échappe.
    const escaped = id.replace(/[$]/g, "\\$&");
    const re = new RegExp(
      `(?:^|[^A-Za-z0-9_$])${escaped}=new Date\\(\`([^\`]+)\`\\)`
    );
    const match = mainJs.match(re);
    if (!match) continue;

    const iso = match[1];
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) continue;

    sandbox[id] = date;
  }
}

/**
 * Résout les références à des constantes numériques externes au literal.
 *
 * Le bundle peut déclarer `varName = 1320 * 60` puis utiliser `secondsToMature: varName`
 * dans les entrées de plantes. Sans pré-résolution, le proxy sandbox renvoie un enum
 * proxy vide -> sérialisation en `{}` au lieu du nombre attendu.
 *
 * Scanne le literal pour tous les identifiants utilisés comme valeurs nues
 * (`key: ident,`) puis recherche dans le bundle une assignation `ident = <expr>`
 * dont l'évaluation produit un nombre fini.
 */
export function applyNumericConstants(mainJs, objLiteral, sandbox) {
  const RESERVED = new Set([
    "true",
    "false",
    "null",
    "undefined",
    "NaN",
    "Infinity",
  ]);

  const ids = new Set(
    [...objLiteral.matchAll(/[:,]\s*([A-Za-z_$][\w$]*)\s*(?=[,;}\]])/g)]
      .map((m) => m[1])
      .filter((id) => !RESERVED.has(id))
  );

  for (const id of ids) {
    const escaped = id.replace(/[$]/g, "\\$&");
    const re = new RegExp(
      `(?:^|[^A-Za-z0-9_$.])${escaped}\\s*=\\s*([^,;\\n}]+)`
    );
    const match = mainJs.match(re);
    if (!match) continue;

    const expr = match[1].trim();
    // Garde-fou: l'expression doit ressembler à un calcul numérique pur
    // (chiffres, opérateurs, parenthèses, points, espaces).
    if (!/^[0-9.\s+\-*/()]+$/.test(expr)) continue;

    let value;
    try {
      value = vm.runInNewContext(expr, {}, { timeout: 100 });
    } catch {
      continue;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    sandbox[id] = value;
  }
}

/**
 * Sandbox de base partagé par toutes les catégories.
 * Résout automatiquement: rarity, weather, sprite mapping, expiry dates,
 * constantes numériques.
 */
export function buildBaseSandbox(mainJs, objLiteral) {
  const sandbox = makeGlobalSandboxProxy();

  applyRarityEnum(mainJs, objLiteral, sandbox);
  applyWeatherEnums(mainJs, objLiteral, sandbox);
  applySpriteMapping(mainJs, objLiteral, sandbox);
  applyDateConstants(mainJs, objLiteral, sandbox);
  applyNumericConstants(mainJs, objLiteral, sandbox);

  return sandbox;
}
