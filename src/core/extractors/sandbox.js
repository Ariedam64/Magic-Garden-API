// src/core/extractors/sandbox.js

import vm from "node:vm";

import {
  makeEnumProxy,
  makeGlobalSandboxProxy,
  tryExtractStringEnum,
} from "../game/bundle/sandbox.js";
import { extractSpriteMapping } from "../game/bundle/spriteMapping.js";
import { extractBalanced } from "../game/bundle/extractor.js";

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
    /\b(?:sprite|immatureSprite|topmostLayerSprite|iconSpriteKey|activationSprite):([A-Za-z_$][\w$]*)\.(?:Seed|Plant|TallPlant|Pet|PetCosmetic|Decor|Item|Mutation|MutationOverlay|Animation|Ui)\./
  );
  if (!match) return;

  const result = extractSpriteMapping(mainJs);
  if (result?.mapping) {
    sandbox[match[1]] = result.mapping;
  }
}

// Chunks du jeu connus, par nom de fichier (`RoomConnection-xxx.js` -> source).
let linkedChunks = new Map();

export function setLinkedChunks(chunks) {
  linkedChunks = new Map(
    (chunks ?? []).map(({ url, content }) => [String(url).split("/").pop(), content])
  );
}

function findDateAssignment(js, id) {
  const escaped = id.replace(/[$]/g, "\\$&");
  const re = new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}=new Date\\(\`([^\`]+)\`\\)`);
  return js.match(re)?.[1] ?? null;
}

/**
 * Suit `import{cr as Ht}from"./Chunk.js"` jusqu'à l'export `export{Ot as cr}`
 * de ce chunk, puis y cherche `Ot=new Date(...)`. Les noms exportés sont très
 * courts et se répètent d'un chunk à l'autre, d'où la résolution par fichier.
 */
function findImportedDate(js, id) {
  for (const m of js.matchAll(/import\{([^}]*)\}from["`]\.\/([^"`]+)["`]/g)) {
    for (const spec of m[1].split(",")) {
      const [exported, local = exported] = spec.trim().split(/\s+as\s+/);
      if (local !== id) continue;
      const target = linkedChunks.get(m[2]);
      if (!target) return null;
      for (const e of target.matchAll(/export\{([^}]*)\}/g)) {
        for (const ex of e[1].split(",")) {
          const [inner, alias = inner] = ex.trim().split(/\s+as\s+/);
          if (alias === exported) return findDateAssignment(target, inner);
        }
      }
      return null;
    }
  }
  return null;
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
    // Cherche `<id>=new Date(`...`)` dans le chunk, sinon dans le chunk d'où
    // `<id>` est importé (1324 : les dates vivent dans LocalizedTextContent).
    const iso = findDateAssignment(mainJs, id) ?? findImportedDate(mainJs, id);
    if (!iso) continue;

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
 * Source de la déclaration `function <id>(...){...}` du bundle.
 *
 * Les noms minifiés se répètent d'une portée à l'autre : on retient la
 * déclaration la plus proche avant `before` (le literal), sinon la première.
 */
function findFunctionDeclaration(js, id, before) {
  const escaped = id.replace(/[$]/g, "\\$&");
  const re = new RegExp(`(?:^|[^A-Za-z0-9_$.])function\\s+${escaped}\\s*\\(`, "g");
  const starts = [...js.matchAll(re)].map((m) => m.index + m[0].indexOf("function"));
  if (starts.length === 0) return null;

  const start = starts.filter((s) => s < before).pop() ?? starts[0];
  const parenIndex = js.indexOf("(", start);
  const params = extractBalanced(js, parenIndex, "(", ")");
  if (params === null) return null;

  let braceIndex = parenIndex + params.length;
  while (/\s/.test(js[braceIndex] ?? "")) braceIndex++;
  if (js[braceIndex] !== "{") return null;

  const body = extractBalanced(js, braceIndex, "{", "}");
  if (body === null) return null;

  return js.slice(start, braceIndex + body.length);
}

/**
 * Résout les fonctions utilitaires appelées dans le literal.
 *
 * En 1778 le jeu fabrique les emplacements de récolte avec un utilitaire,
 * `function P(e,t={}){return Array.from({length:e},()=>({...t}))}`, puis
 * `growSlots:P(5)`. Le proxy sandbox renvoie un enum proxy pour tout
 * identifiant inconnu, qui n'est pas appelable : `P is not a function`, et tout
 * le catalogue des plantes tombait.
 *
 * On reprend la déclaration du bundle telle quelle et on l'évalue dans le
 * sandbox du literal : elle n'a accès qu'à ce qu'il expose.
 */
export function applyHelperFunctions(mainJs, objLiteral, sandbox) {
  const ids = new Set(
    [...objLiteral.matchAll(/(?:[:,[(]|\.\.\.)\s*([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1])
  );
  const literalIndex = mainJs.indexOf(objLiteral);

  for (const id of ids) {
    const source = findFunctionDeclaration(mainJs, id, literalIndex);
    if (!source) continue;

    try {
      sandbox[id] = vm.runInNewContext(`(${source})`, sandbox, { timeout: 100 });
    } catch {
      continue;
    }
  }
}

/**
 * Sandbox de base partagé par toutes les catégories.
 * Résout automatiquement: rarity, weather, sprite mapping, expiry dates,
 * constantes numériques, fonctions utilitaires.
 */
export function buildBaseSandbox(mainJs, objLiteral) {
  const sandbox = makeGlobalSandboxProxy();

  applyRarityEnum(mainJs, objLiteral, sandbox);
  applyWeatherEnums(mainJs, objLiteral, sandbox);
  applySpriteMapping(mainJs, objLiteral, sandbox);
  applyDateConstants(mainJs, objLiteral, sandbox);
  applyNumericConstants(mainJs, objLiteral, sandbox);
  applyHelperFunctions(mainJs, objLiteral, sandbox);

  return sandbox;
}
