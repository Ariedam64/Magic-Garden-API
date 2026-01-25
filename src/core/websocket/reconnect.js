// src/core/websocket/reconnect.js

import { NO_RECONNECT_CODES } from "./closeCodes.js";

/**
 * Détermine si une reconnexion est autorisée.
 */
export function shouldReconnect({ autoReconnect, manualStop, closeCode }) {
  if (!autoReconnect) return false;
  if (manualStop) return false;
  if (NO_RECONNECT_CODES.has(closeCode)) return false;
  return true;
}

/**
 * Calcule le délai de reconnexion avec exponential backoff + jitter.
 *
 * @param {number} attempt - Numéro de tentative (1, 2, 3, ...)
 * @param {object} options - Options de délai
 * @returns {number} Délai en millisecondes
 */
export function getReconnectDelayMs(attempt, { minDelay = 500, maxDelay = 8000 } = {}) {
  // Exponential backoff: base = minDelay * 2^(attempt-1)
  const base = Math.min(minDelay * Math.pow(2, attempt - 1), maxDelay);

  // Jitter: ±20%
  const jitter = base * 0.2 * (Math.random() * 2 - 1);

  return Math.round(base + jitter);
}
