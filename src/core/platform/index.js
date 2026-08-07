// src/core/platform/index.js

// Client de l'API officielle du jeu (`/platform/v1/*`)
export { fetchShops, fetchWeather, fetchLiveState, SHOPS_PATH, WEATHER_PATH } from "./client.js";

// Normalisation des shops
export {
  normalizeShops,
  withRestockCountdown,
  secondsUntilRestock,
  shopSignature,
} from "./shops.js";

// Normalisation de la météo
export { normalizeWeather, formatWeather, CLEAR_SKIES } from "./weather.js";

// Grille temporelle du jeu (précision des transitions observées par polling)
export { snapToGameGrid, snapIfNearGrid, GRID_MS, CLOCK_SKEW_MS } from "./grid.js";
