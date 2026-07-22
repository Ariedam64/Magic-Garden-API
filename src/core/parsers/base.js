// src/core/parsers/base.js

import EventEmitter from "node:events";

/**
 * Classe de base pour les parsers de données live.
 * Gère le parsing des messages WebSocket (Welcome + patches incrémentaux).
 */
export class BaseParser extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Parse un message brut (string JSON).
   */
  handleRaw(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    this.handleMessage(msg);
  }

  /**
   * Traite un message parsé.
   * À implémenter dans les classes enfants.
   */
  handleMessage(_msg) {
    throw new Error("handleMessage must be implemented");
  }
}

/**
 * Extrait le tableau de patches d'un message d'update incrémental, quel que
 * soit son emballage.
 *
 * Le jeu a annoncé un changement de netcode : `PartialState` (patches au
 * niveau racine du message) devient `RoomFrame` (patches sous `state.patches`)
 * — même contenu, juste un nouveau nom/emballage. On supporte les deux formes
 * ici pour rester compatible pendant ET après la bascule, sans dépendre du
 * moment exact du déploiement côté jeu.
 */
export function extractPatches(msg) {
  if (!msg || typeof msg !== "object") return null;

  if (msg.type === "PartialState" && Array.isArray(msg.patches)) {
    return msg.patches;
  }

  if (msg.type === "RoomFrame" && Array.isArray(msg.state?.patches)) {
    return msg.state.patches;
  }

  return null;
}

/**
 * Applique un JSON patch sur un objet.
 * Supporte add/replace/remove.
 */
export function applyPatch(root, path, value, op = "replace") {
  const parts = String(path || "")
    .split("/")
    .filter(Boolean);

  if (!parts.length) return;

  let cur = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = parts[i + 1];
    const nextIsIndex = Number.isInteger(Number(next));

    if (cur[key] == null) cur[key] = nextIsIndex ? [] : {};
    cur = cur[key];
  }

  const last = parts[parts.length - 1];
  const isIndex = Number.isInteger(Number(last));
  const k = isIndex ? Number(last) : last;

  if (op === "remove") {
    if (Array.isArray(cur) && isIndex) cur.splice(k, 1);
    else delete cur[k];
    return;
  }

  cur[k] = value; // add / replace
}
