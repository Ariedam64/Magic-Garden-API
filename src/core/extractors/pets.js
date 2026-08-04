// src/core/extractors/pets.js

import { extractCategoryWithSandbox } from "../game/bundle/extractor.js";
import { buildBaseSandbox } from "./sandbox.js";

/**
 * Signatures pour trouver les données des pets dans le bundle.
 */
const SIGNATURES = ["coinsToFullyReplenishHunger", "innateAbilityWeights", "hoursToMature"];

/**
 * Reconstruit le champ `sprite` des pets.
 *
 * Le jeu a sorti les pets des atlas TexturePacker : leurs entrées de données
 * n'ont plus de `sprite:` du tout, le visuel est un artboard vectoriel de
 * `rive/pets.riv` résolu par nom d'espèce
 * (`artboardName: <PetId>`, cf. exportPetsFromRive.js). Sans ce complément,
 * `/data/pets` perdrait silencieusement son champ `sprite` alors qu'on
 * continue à servir des PNG — rendus depuis ce même Rive, sous des noms de
 * fichiers identiques aux ids d'espèce.
 *
 * On ne touche à rien si le bundle fournit encore un sprite (retour en arrière
 * du jeu, ou espèce restée dans l'atlas).
 */
function withDefaultSpritePaths(pets) {
  if (!pets || typeof pets !== "object") return pets;

  const out = {};
  for (const [id, data] of Object.entries(pets)) {
    if (!data || typeof data !== "object" || data.sprite) {
      out[id] = data;
      continue;
    }
    out[id] = { sprite: `sprite/pet/${id}`, ...data };
  }
  return out;
}

/**
 * Extrait les données des pets du bundle.
 */
export function extractPets(mainJs) {
  const data = extractCategoryWithSandbox(mainJs, "pets", SIGNATURES, buildBaseSandbox).data;
  return withDefaultSpritePaths(data);
}
