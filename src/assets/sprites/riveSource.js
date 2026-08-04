// src/assets/sprites/riveSource.js

import { config } from "../../config/index.js";
import { getStoredRiveUrl, loadRiveInventory } from "../../core/game/riveStorage.js";
import { PET_STATE_MACHINE } from "./exportPetsFromRive.js";

/**
 * Le fichier Rive lui-même, publié comme une ressource de l'API.
 *
 * Les WebP qu'on pré-encode servent les clients qui ne peuvent qu'afficher une
 * image (embed Discord, README, mail). Un client capable de faire tourner le
 * runtime Rive, lui, a tout intérêt à jouer le `.riv` directement : 3 Mo pour
 * **toutes** les espèces et **toutes** leurs timelines, en vectoriel, à
 * n'importe quelle cadence — là où la même couverture en WebP se compte en
 * centaines de mégaoctets.
 *
 * Ce module publie donc ce qu'il faut pour le faire, et surtout ce qui ne se
 * devine pas : le nom de la state machine et celui de l'artboard. Un client qui
 * les code en dur casserait en silence à la première maj du jeu.
 */

// Le fichier est servi par magicgarden.gg sans en-tête CORS : un navigateur ne
// peut pas aller le chercher lui-même. On publie donc l'URL passant par notre
// proxy, qui ajoute `Access-Control-Allow-Origin`.
function proxied(riveUrl) {
  const base = (config.sprites.baseUrl || "").replace(/\/$/, "");
  return `${base}/assets/proxy?url=${encodeURIComponent(riveUrl)}`;
}

/**
 * Bloc `rive` d'une entrée de pet.
 *
 * @param {string} artboard - Nom de l'artboard (= id d'espèce)
 * @param {string|null} riveUrl - URL amont du .riv
 * @returns {object|null}
 */
export function buildRiveSource(artboard, riveUrl, stateMachine = PET_STATE_MACHINE) {
  if (!riveUrl || !artboard) return null;

  return {
    url: proxied(riveUrl),
    origin: riveUrl,
    artboard,
    ...(stateMachine ? { stateMachine } : {}),
  };
}

/**
 * URL du .riv des pets telle qu'elle a servi au dernier export.
 *
 * On lit l'URL **exportée**, pas celle du manifest courant : c'est elle qui
 * correspond aux PNG et aux WebP servis à côté. Publier une URL plus récente
 * que nos rendus donnerait un `.riv` incohérent avec les images.
 */
export async function getPetsRiveUrl() {
  return getStoredRiveUrl("pets").catch(() => null);
}

/**
 * URL d'un `.riv` quelconque, telle que relevée par le dernier inventaire.
 *
 * Contrairement aux pets, les autres fichiers n'ont pas d'export d'images à
 * garder cohérent : l'inventaire suffit.
 */
export async function getRiveUrlFromInventory(key) {
  const { files } = await loadRiveInventory();
  return files?.[key]?.url ?? null;
}
