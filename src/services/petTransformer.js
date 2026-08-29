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
 * Rapproche un nom d'artboard d'un identifiant de données.
 *
 * Le `.riv` et les données du jeu ne nomment pas toujours une espèce pareil :
 * l'artboard du Red Fox s'appelle `Red Fox`, là où les données l'appellent
 * `RedFox` — même écart que `StoneBirdBath`/`StoneBirdbath` côté décors. Sans
 * ce rapprochement l'espèce sort **deux fois** de `/data/pets` : l'entrée de
 * données, privée de son PNG (rangé sous le nom de l'artboard) et de ses
 * animations, et un faux `released: false` qui porte tout l'art mais aucune
 * statistique.
 */
const artboardKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Index clé normalisée -> nom d'artboard réel, sur tout ce que Rive fournit.
 */
function artboardIndex(frames, animations) {
  const index = new Map();

  const add = (name) => {
    const key = artboardKey(name);
    if (!index.has(key)) index.set(key, name);
  };

  for (const meta of Object.values(frames)) {
    if (meta.cat !== "pets") continue;
    if (meta.name !== meta.artboard) continue;
    add(meta.name);
  }

  for (const name of Object.keys(animations)) add(name);

  return index;
}

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
  // Comparé sur la clé normalisée : un artboard n'est « pas encore sorti » que
  // si aucune entrée de données ne lui correspond, même orthographiée
  // autrement.
  const known = new Set(Object.keys(bundlePets).map(artboardKey));
  const species = [];

  for (const meta of Object.values(frames)) {
    if (meta.cat !== "pets") continue;
    // Les variantes météo (`FireHorseActive`…) sont rendues sous un nom qui
    // n'est pas celui de leur artboard : ce sont des états d'une espèce
    // existante, pas des espèces.
    if (meta.name !== meta.artboard) continue;
    if (known.has(artboardKey(meta.name))) continue;
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

  const boards = artboardIndex(frames, animations);

  const decorate = (id, pet) => {
    // Tout l'art (PNG rendu, boucles WebP, artboard du .riv) est rangé sous le
    // nom de l'artboard, pas sous l'identifiant de données. Quand les deux
    // divergent, c'est l'artboard qui adresse les fichiers.
    const artboard = boards.get(artboardKey(id)) ?? id;
    const links = buildAnimationLinks("pets", artboard, { animations, version: spriteVersion });
    const rive = animations[artboard] || frames[`sprite/pet/${artboard}`]
      ? buildRiveSource(artboard, riveUrl)
      : null;

    if (!links && !rive) return pet;

    return {
      ...pet,
      // Le `sprite` dérivé des données pointerait sur `RedFox.png`, qui
      // n'existe pas : le rendu est sur disque sous `Red Fox.png`.
      ...(artboard !== id ? { sprite: buildSpriteUrl("pets", artboard, { version: spriteVersion }) } : {}),
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
