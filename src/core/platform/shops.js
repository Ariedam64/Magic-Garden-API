// src/core/platform/shops.js

/**
 * Normalisation des shops renvoyés par `/platform/v1/shops`.
 *
 * Forme officielle (un shop) :
 *   { open: true, nextRestockAt: "2026-08-07T15:05:00.000Z",
 *     items: [{ itemId: "Carrot", itemType: "Seed", name: "Carrot Seed", stock: 16 }] }
 *
 * Forme publique de notre API (inchangée depuis l'époque WebSocket, plus trois
 * champs) : `items[].name` reste l'identifiant canonique (`Carrot`), pas le nom
 * d'affichage — c'est la clé utilisée partout ailleurs (historique SQLite,
 * `purchasable` des plantes, sprites), et le jeu envoyait déjà cet id via
 * `species`/`eggId`/`toolId`/`decorId`.
 */

/**
 * Normalise un item de shop.
 *
 * `itemId` est l'identifiant canonique dans tous les shops, y compris les shops
 * mixtes d'évènement (dawn/snow/thunder) où œufs, graines, potions et décor
 * cohabitent — l'API officielle a supprimé le besoin de deviner le champ d'id
 * selon le type (ce que faisait `getShopItemName` côté WebSocket).
 */
function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;

  const id = typeof item.itemId === "string" ? item.itemId.trim() : "";
  if (!id) return null;

  const stock = Number(item.stock ?? 0);
  if (!Number.isFinite(stock) || stock <= 0) return null;

  return {
    name: id,
    displayName: typeof item.name === "string" && item.name ? item.name : id,
    itemType: typeof item.itemType === "string" && item.itemType ? item.itemType : null,
    stock,
  };
}

/**
 * Normalise un shop.
 */
function normalizeShop(shop) {
  if (!shop || typeof shop !== "object") return null;

  const items = (Array.isArray(shop.items) ? shop.items : [])
    .map(normalizeItem)
    .filter(Boolean);

  // `nextRestockAt` vaut null sur les shops fermés (dawn/snow/thunder hors
  // évènement) : on le propage tel quel plutôt que d'inventer une échéance.
  const nextRestockAt =
    typeof shop.nextRestockAt === "string" && shop.nextRestockAt ? shop.nextRestockAt : null;

  return {
    open: shop.open === true,
    nextRestockAt,
    items,
  };
}

/**
 * Normalise la réponse complète de `/platform/v1/shops`.
 *
 * Itère dynamiquement sur les shops présents : aucun type codé en dur, donc un
 * nouveau shop ajouté par le jeu apparaît automatiquement.
 *
 * @returns {object|null} map `shopType -> { open, nextRestockAt, items }`
 */
export function normalizeShops(payload) {
  // Tolère `{ shops: {...} }` (forme actuelle) comme une map nue.
  const shops = payload && typeof payload === "object" && payload.shops ? payload.shops : payload;
  if (!shops || typeof shops !== "object" || Array.isArray(shops)) return null;

  const result = {};
  for (const [type, shop] of Object.entries(shops)) {
    const normalized = normalizeShop(shop);
    if (normalized) result[type] = normalized;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Ajoute le compte à rebours `secondsUntilRestock`, dérivé de `nextRestockAt`.
 *
 * Calculé à la lecture et non au polling : le champ reste ainsi exact entre
 * deux requêtes à l'API officielle, alors que le `secondsUntilRestock` que
 * relayait le WebSocket vieillissait entre deux patches.
 */
export function withRestockCountdown(shops, now = Date.now()) {
  if (!shops) return null;

  const result = {};
  for (const [type, shop] of Object.entries(shops)) {
    result[type] = {
      ...shop,
      secondsUntilRestock: secondsUntilRestock(shop.nextRestockAt, now),
    };
  }
  return result;
}

/**
 * Secondes restantes avant restock, 0 si inconnu/dépassé (shop fermé).
 */
export function secondsUntilRestock(nextRestockAt, now = Date.now()) {
  if (!nextRestockAt) return 0;

  const at = Date.parse(nextRestockAt);
  if (!Number.isFinite(at)) return 0;

  return Math.max(0, Math.round((at - now) / 1000));
}

/**
 * Signature d'un shop, indépendante du temps.
 *
 * Sert à détecter un vrai changement entre deux polls sans que le compte à
 * rebours ne fasse tout paraître différent à chaque seconde.
 */
export function shopSignature(shop) {
  if (!shop) return "";

  const items = shop.items
    .map((it) => `${it.name}:${it.stock}`)
    .sort()
    .join("|");

  return `${shop.open ? 1 : 0}@${shop.nextRestockAt ?? "-"}#${items}`;
}
