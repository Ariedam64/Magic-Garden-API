// src/core/game/bundle/spriteMapping.js

import { findObjectLiteralBySignatures, runObjectLiteral } from "./extractor.js";
import { makeGlobalSandboxProxy } from "./sandbox.js";
import { logger } from "../../../logger/index.js";

/**
 * Signatures stables pour localiser l'objet sprite mapping dans le bundle.
 * Ces strings littérales ne changent jamais après minification.
 */
const SPRITE_MAPPING_SIGNATURES = [
  "`sprite/seed/",
  "`sprite/plant/",
  "`sprite/pet/",
  "`sprite/decor/",
];

/** Clés attendues dans l'objet sprite mapping pour validation. */
const REQUIRED_KEYS = ["Seed", "Plant", "Pet", "Decor"];

// Groupe (nom d'enum côté jeu) -> segment de chemin dans l'atlas.
// Le jeu construit ces chemins comme `sprite/<slug>/<clé>` (on l'a vu en clair
// dans un bloc de config de notifications qui utilise le même helper :
// `spritePathOf:e=>\`sprite/seed/${e}.png\``) — donc quand la vraie table
// littérale n'est plus repérable (ex: le build l'a remplacée par un accès
// Proxy généré à la volée plutôt qu'un objet statique), on peut reconstruire
// les chemins nous-mêmes plutôt que de perdre le champ sprite en silence.
const GROUP_SLUGS = {
  Seed: "seed",
  Plant: "plant",
  TallPlant: "tallplant",
  Pet: "pet",
  Decor: "decor",
  Item: "item",
  Mutation: "mutation",
  MutationOverlay: "mutation-overlay",
  Animation: "animation",
  Ui: "ui",
};

function buildFallbackMapping() {
  const mapping = {};
  for (const [group, slug] of Object.entries(GROUP_SLUGS)) {
    mapping[group] = new Proxy(
      {},
      {
        get: (_t, prop) =>
          typeof prop === "symbol" ? undefined : `sprite/${slug}/${String(prop)}`,
      }
    );
  }
  return mapping;
}

let cache = null;

/**
 * Extrait l'objet sprite mapping du bundle.
 *
 * Tente d'abord de localiser et d'évaluer la vraie table littérale (la plus
 * fidèle, y compris pour d'éventuelles clés dont le nom diverge du chemin
 * sprite réel). Si elle est introuvable ou invalide — par exemple si le
 * repérage par signature verrouille sur un autre objet du bundle qui partage
 * les mêmes préfixes `` `sprite/xxx/ `` (ex: des configs de notification avec
 * un `spritePathOf` dynamique) — on retombe sur une reconstruction
 * déterministe plutôt que de laisser tous les champs sprite disparaître.
 *
 * @param {string} mainJs - Contenu du bundle
 * @returns {{ varName: string|null, mapping: object, isFallback: boolean }}
 */
export function extractSpriteMapping(mainJs) {
  if (cache) return cache;

  const hit = findObjectLiteralBySignatures(mainJs, SPRITE_MAPPING_SIGNATURES);

  if (hit) {
    const sandbox = makeGlobalSandboxProxy();
    const mapping = runObjectLiteral(hit.objLiteral, sandbox);

    const valid =
      mapping &&
      typeof mapping === "object" &&
      REQUIRED_KEYS.every((k) => k in mapping && typeof mapping[k] === "object");

    if (valid) {
      cache = { varName: hit.varName, mapping, isFallback: false };
      return cache;
    }
  }

  logger.warn(
    "Sprite mapping table not found/valid in bundle, using deterministic sprite/<group>/<key> fallback"
  );

  cache = { varName: hit?.varName ?? null, mapping: buildFallbackMapping(), isFallback: true };
  return cache;
}

/**
 * Vide le cache du sprite mapping.
 */
export function clearSpriteMappingCache() {
  cache = null;
}
