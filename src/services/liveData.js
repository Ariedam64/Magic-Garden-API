// src/services/liveData.js

import {
  getLiveStats,
  getShops,
  getShopsRaw,
  getWeather,
  getWeatherDetails,
  onShopsChange,
  onWeatherChange,
} from "./livePoller.js";

/**
 * Service pour les données live du jeu.
 *
 * Alimenté par l'API officielle `/platform/v1/{shops,weather}` (voir
 * `livePoller.js`). L'interface est inchangée depuis l'époque WebSocket : les
 * routes, l'historique et `plantTransformer` la consomment telle quelle.
 */
export const liveDataService = {
  /**
   * Récupère les données des shops (avec `secondsUntilRestock` à jour).
   */
  getShops() {
    return getShops();
  },

  /**
   * Récupère les données brutes des shops, telles que renvoyées par le jeu.
   */
  getShopsRaw() {
    return getShopsRaw();
  },

  /**
   * Récupère la météo actuelle (libellé, ex. `Rain`).
   */
  getWeather() {
    return getWeather();
  },

  /**
   * Récupère la météo actuelle détaillée (`startedAt`/`endsAt` quand l'API
   * officielle les fournit).
   */
  getWeatherDetails() {
    return getWeatherDetails();
  },

  /**
   * Récupère toutes les données live.
   */
  getAll() {
    return {
      weather: getWeather(),
      shops: getShops(),
    };
  },

  /**
   * Statistiques du poller (diagnostic).
   */
  getStats() {
    return getLiveStats();
  },

  /**
   * S'abonne aux changements de shops.
   */
  onShopsChange(callback) {
    return onShopsChange(callback);
  },

  /**
   * S'abonne aux changements de météo.
   */
  onWeatherChange(callback) {
    return onWeatherChange(callback);
  },

  /**
   * Retourne le Set des species de seeds présentes dans le shop.
   * Retourne null si les données du shop ne sont pas encore disponibles.
   */
  getShopSeedSpecies() {
    const shops = getShops();
    if (!shops?.seed?.items) return null;

    return new Set(shops.seed.items.map((item) => item.name).filter(Boolean));
  },
};
