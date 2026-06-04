// src/core/parsers/shop.js

import { BaseParser, applyPatch } from "./base.js";

// Champs d'identifiant connus, testés dans l'ordre. Chaque item ne renseigne
// que le champ correspondant à son type (un seed n'a que `species`, un egg que
// `eggId`, etc.), donc un item mixte (shop dawn/snow) est résolu correctement.
const ITEM_ID_FIELDS = [
  "species",
  "eggId",
  "toolId",
  "decorId",
  "potionId",
  "seedId",
  "itemId",
];

/**
 * Extrait le nom canonique d'un item de shop, quel que soit son type.
 *
 * Générique par conception : gère les shops mono-type (seed, tool, egg, decor)
 * comme les shops mixtes (dawn, snow) qui contiennent œufs, graines, potions et
 * décor côte à côte — et reste robuste si le jeu ajoute de nouveaux types.
 */
function getShopItemName(item) {
  if (!item) return null;

  for (const field of ITEM_ID_FIELDS) {
    if (item[field]) return item[field];
  }

  // Filet de sécurité : tout champ se terminant par `Id` (nouveau type inconnu).
  for (const [key, value] of Object.entries(item)) {
    if (/Id$/.test(key) && typeof value === "string" && value) return value;
  }

  return item.name ?? null;
}

/**
 * Simplifie les données d'un shop.
 */
function simplifyShop(shop) {
  if (!shop) return null;

  const inv = Array.isArray(shop.inventory) ? shop.inventory : [];

  const items = inv
    .filter((it) => Number(it?.initialStock ?? 0) > 0)
    .map((it) => ({
      name: getShopItemName(it),
      stock: Number(it.initialStock ?? 0),
    }))
    .filter((it) => it.name);

  return {
    secondsUntilRestock: Number(shop.secondsUntilRestock ?? 0),
    items,
  };
}

/**
 * Simplifie les données de tous les shops.
 *
 * Itère dynamiquement sur tous les shops présents : aucun type codé en dur, donc
 * un nouveau shop envoyé par le jeu (ex. `snow`) apparaît automatiquement.
 */
function simplifyShops(shops) {
  if (!shops || typeof shops !== "object") return null;

  const result = {};
  for (const [type, shop] of Object.entries(shops)) {
    result[type] = simplifyShop(shop);
  }
  return result;
}

/**
 * Parser pour les données des shops.
 *
 * Events:
 * - shops: Émis quand les shops changent (avec les données simplifiées)
 */
export class ShopParser extends BaseParser {
  constructor() {
    super();
    this.shops = null;
    this.lastSlim = null;
    this.lastSlimHash = null;
  }

  /**
   * Retourne les données brutes des shops.
   */
  getShops() {
    return this.shops;
  }

  /**
   * Retourne les données simplifiées des shops.
   */
  getSlimShops() {
    if (!this.shops) return null;

    if (this.lastSlim) {
      return this.lastSlim;
    }

    const slim = simplifyShops(this.shops);
    this.lastSlim = slim;
    this.lastSlimHash = JSON.stringify(slim);
    return slim;
  }

  /**
   * Traite un message WebSocket.
   */
  handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    // Welcome = full state
    if (msg.type === "Welcome" && msg.fullState) {
      const game = msg.fullState?.child?.data || null;
      if (!game) return;

      if (game.shops) {
        this.shops = game.shops;
        const slim = simplifyShops(this.shops);
        const hash = JSON.stringify(slim);
        if (hash !== this.lastSlimHash) {
          this.lastSlim = slim;
          this.lastSlimHash = hash;
          this.emit("shops", slim);
        }
      }
      return;
    }

    // PartialState = patches
    if (msg.type !== "PartialState" || !Array.isArray(msg.patches)) return;

    let dirty = false;

    for (const p of msg.patches) {
      if (!p || typeof p.path !== "string") continue;

      // Remplacement complet des shops
      if (p.path === "/child/data/shops") {
        this.shops = p.value ?? {};
        dirty = true;
        continue;
      }

      // Patch partiel d'un shop
      if (p.path.startsWith("/child/data/shops/")) {
        if (!this.shops) this.shops = {};
        const rel = p.path.replace("/child/data/shops", "");
        applyPatch(this.shops, rel, p.value, p.op);
        dirty = true;
      }
    }

    if (dirty) {
      const slim = simplifyShops(this.shops);
      const hash = JSON.stringify(slim);
      if (hash !== this.lastSlimHash) {
        this.lastSlim = slim;
        this.lastSlimHash = hash;
        this.emit("shops", slim);
      }
    }
  }
}
