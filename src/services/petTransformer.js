// src/services/petTransformer.js

import { gameDataService } from "./gameData.js";
import { transformDataWithSprites } from "./dataTransformer.js";
import { getAnimations, buildAnimationLinks } from "../assets/sprites/riveAnimations.js";
import { getRiveFrames } from "../assets/sprites/riveFrames.js";
import { buildRiveSource, getPetsRiveUrl } from "../assets/sprites/riveSource.js";
import { buildSpriteUrl } from "../utils/spriteUrlBuilder.js";

/**
 * Données de pets enrichies de tout ce que le fichier Rive apporte.
 *
 * Les pets sont le seul contenu du jeu qui soit vectoriel (`rive/pets.riv`).
 * Ça donne trois compléments aux données du bundle :
 *
 * 1. `animations` — les boucles WebP pré-encodées, pour les clients qui ne
 *    savent qu'afficher une image.
 * 2. `rive` — de quoi rejouer l'animation en direct pour ceux qui le peuvent,
 *    y compris ce qui ne se devine pas (nom de l'artboard, de la state machine).
 * 3. Les **espèces pas encore sorties** : le `.riv` contient des artboards que
 *    les données du jeu ne mentionnent pas encore. Voir ci-dessous.
 */

/**
 * Ajoute les espèces présentes dans le `.riv` mais absentes des données du jeu.
 *
 * Le fichier Rive est livré avec le client, donc il précède les données : à la
 * v824 il contient `Rooster` et `Hedgehog`, deux pets que `/data/pets` ignore
 * encore. Comme l'export rend *tous* les artboards, on a déjà leur PNG et leurs
 * boucles — il ne manquait que de les nommer.
 *
 * Ces entrées portent `released: false` et n'ont aucune statistique : il n'en
 * existe pas. Un client qui construit une boutique doit les filtrer ; un client
 * qui construit un bestiaire voudra les montrer.
 */
function unreleasedSpecies(bundlePets, frames) {
  const known = new Set(Object.keys(bundlePets));
  const species = [];

  for (const meta of Object.values(frames)) {
    if (meta.cat !== "pets") continue;
    // Les variantes météo (`FireHorseActive`…) sont rendues sous un nom qui
    // n'est pas celui de leur artboard : ce sont des états d'une espèce
    // existante, pas des espèces.
    if (meta.name !== meta.artboard) continue;
    if (known.has(meta.name)) continue;
    species.push(meta.name);
  }

  return species.sort();
}

/**
 * @param {object} options
 * @param {string|null} options.spriteVersion
 * @returns {Promise<object>} pets indexés par id
 */
export async function getTransformedPets({ spriteVersion = null } = {}) {
  const data = await gameDataService.getPets();
  const transformed = transformDataWithSprites(data, "pets", { spriteVersion });

  const [{ animations }, frames, riveUrl] = await Promise.all([
    getAnimations("pets"),
    getRiveFrames(),
    getPetsRiveUrl(),
  ]);

  const decorate = (id, pet) => {
    const links = buildAnimationLinks("pets", id, { animations, version: spriteVersion });
    const rive = animations[id] || frames[`sprite/pet/${id}`] ? buildRiveSource(id, riveUrl) : null;

    if (!links && !rive) return pet;

    return {
      ...pet,
      ...(links ? { animations: links } : {}),
      ...(rive ? { rive } : {}),
    };
  };

  const out = {};
  for (const [id, pet] of Object.entries(transformed)) {
    out[id] = pet && typeof pet === "object" ? decorate(id, pet) : pet;
  }

  for (const name of unreleasedSpecies(transformed, frames)) {
    out[name] = decorate(name, {
      name,
      released: false,
      sprite: buildSpriteUrl("pets", name, { version: spriteVersion }),
    });
  }

  return out;
}
