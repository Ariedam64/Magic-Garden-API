// src/services/liveData.js

import { ShopParser, WeatherParser } from "../core/parsers/index.js";

// Singletons - état conservé en mémoire
const shopParser = new ShopParser();
const weatherParser = new WeatherParser();

/**
 * Service pour les données live du jeu (via WebSocket).
 */
export const liveDataService = {
  /**
   * Traite un message WebSocket brut.
   * À appeler depuis le handler de messages WS.
   */
  handleRawMessage(raw) {
    shopParser.handleRaw(raw);
    weatherParser.handleRaw(raw);
  },

  /**
   * Récupère les données des shops.
   */
  getShops() {
    return shopParser.getSlimShops();
  },

  /**
   * Récupère les données brutes des shops.
   */
  getShopsRaw() {
    return shopParser.getShops();
  },

  /**
   * Récupère la météo actuelle.
   */
  getWeather() {
    return weatherParser.getWeather();
  },

  /**
   * Récupère toutes les données live.
   */
  getAll() {
    return {
      weather: weatherParser.getWeather(),
      shops: shopParser.getSlimShops(),
    };
  },

  /**
   * S'abonne aux changements de shops.
   */
  onShopsChange(callback) {
    shopParser.on("shops", callback);
    return () => shopParser.off("shops", callback);
  },

  /**
   * S'abonne aux changements de météo.
   */
  onWeatherChange(callback) {
    weatherParser.on("weather", callback);
    return () => weatherParser.off("weather", callback);
  },

  /**
   * Retourne le Set des species de seeds présentes dans le shop.
   * Retourne null si les données du shop ne sont pas encore disponibles.
   */
  getShopSeedSpecies() {
    const shops = shopParser.getShops();
    if (!shops?.seed?.inventory) return null;

    return new Set(
      shops.seed.inventory
        .map((item) => item.species)
        .filter(Boolean)
    );
  },

  /**
   * Retourne les parsers (pour accès avancé).
   */
  getParsers() {
    return { shopParser, weatherParser };
  },
};
