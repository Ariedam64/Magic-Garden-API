// src/core/parsers/shop.js

import { BaseParser, applyPatch } from "./base.js";

/**
 * Extrait le nom d'un item de shop selon son type.
 */
function getShopItemName(item, shopType) {
  if (!item) return null;

  switch (shopType) {
    case "seed":
      return item.species ?? null;
    case "tool":
      return item.toolId ?? null;
    case "egg":
      return item.eggId ?? null;
    case "decor":
      return item.decorId ?? null;
    default:
      return null;
  }
}

/**
 * Simplifie les données d'un shop.
 */
function simplifyShop(shop, type) {
  if (!shop) return null;

  const inv = Array.isArray(shop.inventory) ? shop.inventory : [];

  const items = inv
    .filter((it) => Number(it?.initialStock ?? 0) > 0)
    .map((it) => ({
      name: getShopItemName(it, type),
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
 */
function simplifyShops(shops) {
  if (!shops || typeof shops !== "object") return null;

  return {
    seed: simplifyShop(shops.seed, "seed"),
    tool: simplifyShop(shops.tool, "tool"),
    egg: simplifyShop(shops.egg, "egg"),
    decor: simplifyShop(shops.decor, "decor"),
  };
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
    return simplifyShops(this.shops);
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
        this.emit("shops", this.getSlimShops());
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
      this.emit("shops", this.getSlimShops());
    }
  }
}
