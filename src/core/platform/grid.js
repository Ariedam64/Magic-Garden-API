// src/core/platform/grid.js

/**
 * Grille temporelle du jeu.
 *
 * Shops et météo tournent sur une grille de 5 minutes : sur les 200 derniers
 * restocks `seed` relevés via WebSocket, 200 tombent exactement sur un multiple
 * de 300 s, et 190 des 200 derniers changements de météo aussi (le reste à 1-5 s
 * près, soit la latence de l'ancien flux). Les créneaux fixes des météos
 * lunaires sont eux-mêmes exprimés en pas de 5 minutes.
 *
 * C'est ce qui permet au polling d'égaler la précision de l'ancien WebSocket :
 * un poll ne situe une transition qu'à quelques secondes près, mais l'instant
 * réel est toujours sur la grille.
 */
export const GRID_MS = 5 * 60 * 1000;

/** Tolérance pour une horloge locale légèrement en avance. */
export const CLOCK_SKEW_MS = 5000;

/**
 * Ramène un horodatage observé sur la borne de grille correspondante.
 *
 * Une observation par polling arrive toujours *après* la transition réelle, donc
 * on redescend sur la borne inférieure. Seul cas particulier : une horloge locale
 * de quelques secondes en avance, ramenée sur la borne suivante.
 */
export function snapToGameGrid(ts) {
  const offset = ts % GRID_MS;
  return offset > GRID_MS - CLOCK_SKEW_MS ? ts - offset + GRID_MS : ts - offset;
}

/**
 * Recale un horodatage sur la grille *seulement* s'il en est déjà très proche.
 *
 * Sert à corriger le bruit d'un intervalle déduit — un intervalle de 599 s
 * mesuré à l'époque du WebSocket pour un shop qui tourne en réalité sur 600 s
 * décale l'instant reconstitué d'une seconde. Au-delà de la tolérance on ne
 * touche à rien : une boutique dont le cycle ne suit pas la grille (comme le
 * shop `apology`, ouvert à la main) ne doit pas être déplacée de force.
 */
export function snapIfNearGrid(ts, toleranceMs = 10 * 1000) {
  const offset = ts % GRID_MS;
  if (offset <= toleranceMs) return ts - offset;
  if (offset >= GRID_MS - toleranceMs) return ts - offset + GRID_MS;
  return ts;
}
