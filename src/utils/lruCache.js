// src/utils/lruCache.js

/**
 * Cache LRU borné en nombre d'entrées et/ou en octets, avec expiration
 * facultative des entrées restées inutilisées.
 *
 * L'expiration est active (un timer par entrée, `unref` pour ne pas retenir le
 * processus) : les caches qui en ont besoin servent quelques requêtes par jour,
 * et une purge paresseuse au prochain accès garderait leurs dizaines de Mo
 * toute la journée.
 */
export class LruCache {
  #map = new Map(); // key -> { value, size, timer }
  #bytes = 0;

  /**
   * @param {object} options
   * @param {number} options.max - Nombre maximal d'entrées
   * @param {number} options.maxBytes - Taille cumulée maximale
   * @param {(value: any) => number} options.sizeOf - Taille d'une valeur, en octets
   * @param {number} options.idleMs - Durée de vie d'une entrée non consultée (0 = illimitée)
   */
  constructor({ max = Infinity, maxBytes = Infinity, sizeOf = () => 0, idleMs = 0 } = {}) {
    this.max = max;
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
    this.idleMs = idleMs;
  }

  get size() {
    return this.#map.size;
  }

  get bytes() {
    return this.#bytes;
  }

  has(key) {
    return this.#map.has(key);
  }

  get(key) {
    const entry = this.#map.get(key);
    if (!entry) return undefined;

    // Réinsertion = passage en tête de l'ordre d'usage.
    this.#map.delete(key);
    this.#map.set(key, entry);
    this.#arm(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.delete(key);

    const size = Math.max(0, Number(this.sizeOf(value)) || 0);
    // Une valeur plus grosse que le cache entier n'y entre pas : la garder
    // viderait tout le reste pour elle seule.
    if (this.max < 1 || size > this.maxBytes) return this;

    const entry = { value, size, timer: null };
    this.#map.set(key, entry);
    this.#bytes += size;
    this.#arm(key, entry);

    for (const oldest of this.#map.keys()) {
      if (this.#map.size <= this.max && this.#bytes <= this.maxBytes) break;
      this.delete(oldest);
    }

    return this;
  }

  delete(key) {
    const entry = this.#map.get(key);
    if (!entry) return false;
    if (entry.timer) clearTimeout(entry.timer);
    this.#bytes -= entry.size;
    return this.#map.delete(key);
  }

  clear() {
    for (const entry of this.#map.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.#map.clear();
    this.#bytes = 0;
  }

  #arm(key, entry) {
    if (!this.idleMs) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.#map.get(key) === entry) this.delete(key);
    }, this.idleMs);
    entry.timer.unref?.();
  }
}
