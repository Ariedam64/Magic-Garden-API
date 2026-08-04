// src/services/decorTransformer.js

import { gameDataService } from "./gameData.js";
import { transformDataWithSprites } from "./dataTransformer.js";
import { getAnimations, buildAnimationLinks } from "../assets/sprites/riveAnimations.js";
import { buildRiveSource, getRiveUrlFromInventory } from "../assets/sprites/riveSource.js";
import { loadRiveInventory } from "../core/game/riveStorage.js";

/**
 * Données de décors enrichies de leurs boucles animées.
 *
 * Huit décors du jeu ne sont pas de simples images : ce sont des artboards de
 * `rive/decor.riv` qui tournent en continu (le moulin, la fontaine, le
 * chaudron…). Même principe que pour les pets — on sert la boucle WebP, et le
 * `.riv` pour qui sait le rejouer.
 *
 * Deux différences avec les pets :
 *
 * 1. **La casse ne concorde pas toujours.** L'artboard s'appelle
 *    `StoneBirdBath`, la donnée du jeu `StoneBirdbath`. Le rapprochement se
 *    fait donc sans tenir compte de la casse, sinon ce décor perdrait son
 *    animation en silence.
 * 2. **Les inédits n'ont pas d'image.** `WeatherStation` et `BoobooBooth`
 *    existent dans le `.riv` mais nulle part ailleurs : ni données, ni PNG
 *    d'atlas. Ils sortent donc avec une animation mais sans `sprite`.
 */

const CATEGORY = "decor";

/**
 * Index insensible à la casse des identifiants de données.
 */
function indexByLowerCase(data) {
  const index = new Map();
  for (const id of Object.keys(data)) index.set(id.toLowerCase(), id);
  return index;
}

/**
 * Nom de la state machine d'un artboard, relevé par l'inventaire.
 *
 * Les décors utilisent tous `State Machine 1` aujourd'hui, mais le coder en dur
 * reviendrait à parier là-dessus : on lit ce que le fichier déclare.
 */
function stateMachineOf(inventory, artboardName) {
  const artboards = inventory?.files?.[CATEGORY]?.artboards;
  if (!Array.isArray(artboards)) return null;

  const artboard = artboards.find((a) => a?.name === artboardName);
  return artboard?.stateMachines?.[0]?.name ?? null;
}

/**
 * @param {object} options
 * @param {string|null} options.spriteVersion
 * @returns {Promise<object>} décors indexés par id
 */
export async function getTransformedDecor({ spriteVersion = null } = {}) {
  const data = await gameDataService.getDecor();
  const transformed = transformDataWithSprites(data, CATEGORY, { spriteVersion });

  const [{ animations }, riveUrl, inventory] = await Promise.all([
    getAnimations(CATEGORY),
    getRiveUrlFromInventory(CATEGORY),
    loadRiveInventory(),
  ]);

  const artboards = Object.keys(animations);
  if (!artboards.length) return transformed;

  const byLowerCase = indexByLowerCase(transformed);
  const out = { ...transformed };

  for (const artboard of artboards) {
    const links = buildAnimationLinks(CATEGORY, artboard, {
      animations,
      version: spriteVersion,
    });
    const rive = buildRiveSource(artboard, riveUrl, stateMachineOf(inventory, artboard));
    if (!links && !rive) continue;

    const dataId = byLowerCase.get(artboard.toLowerCase());

    if (dataId) {
      out[dataId] = {
        ...out[dataId],
        ...(links ? { animations: links } : {}),
        ...(rive ? { rive } : {}),
      };
      continue;
    }

    // Décor présent dans le .riv mais absent des données du jeu : même
    // traitement que les espèces de pets pas encore sorties.
    out[artboard] = {
      name: artboard,
      released: false,
      ...(links ? { animations: links } : {}),
      ...(rive ? { rive } : {}),
    };
  }

  return out;
}
