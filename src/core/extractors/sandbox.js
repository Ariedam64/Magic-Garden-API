// src/core/extractors/sandbox.js

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
    /\b(?:sprite|immatureSprite|topmostLayerSprite):([A-Za-z_$][\w$]*)\.(?:Seed|Plant|TallPlant|Pet|Decor|Item|Mutation|MutationOverlay|Animation)\./
  );
  if (!match) return;

  const result = extractSpriteMapping(mainJs);
  if (result?.mapping) {
    sandbox[match[1]] = result.mapping;
  }
}

/**
 * Sandbox de base partagé par toutes les catégories.
 * Résout automatiquement: rarity, weather, sprite mapping.
 */
export function buildBaseSandbox(mainJs, objLiteral) {
  const sandbox = makeGlobalSandboxProxy();

  applyRarityEnum(mainJs, objLiteral, sandbox);
  applyWeatherEnums(mainJs, objLiteral, sandbox);
  applySpriteMapping(mainJs, objLiteral, sandbox);

  return sandbox;
}
