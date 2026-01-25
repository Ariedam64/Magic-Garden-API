// src/utils/id.js

import crypto from "node:crypto";

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Génère une string base58 *uniforme* de longueur fixée (rejection sampling).
 */
function randomBase58(length) {
  let out = "";
  while (out.length < length) {
    const b = crypto.randomBytes(1)[0];
    // 232 = 58 * 4, évite le biais du modulo (256 % 58 != 0)
    if (b < 232) out += BASE58_ALPHABET[b % 58];
  }
  return out;
}

/**
 * Génère un playerId (p_ + 16 chars base58).
 * Exemple: p_4fKz9Qm2YxP7aBcD
 */
export function generatePlayerId() {
  return `p_${randomBase58(16)}`;
}

/**
 * Génère un roomId aléatoire (lowercase, 8 chars).
 */
export function generateRoomId() {
  return crypto.randomBytes(4).toString("hex").toLowerCase();
}
