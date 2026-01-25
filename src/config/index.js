// src/config/index.js

/**
 * Configuration centralisée de l'API.
 * Valeurs par défaut overridées par les variables d'environnement.
 */
export const config = {
  // Serveur HTTP
  server: {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || "0.0.0.0",
  },

  // Cache
  cache: {
    bundleTTL: Number(process.env.CACHE_BUNDLE_TTL) || 5 * 60 * 1000, // 5 min
    manifestTTL: Number(process.env.CACHE_MANIFEST_TTL) || 10 * 60 * 1000, // 10 min
  },

  // Rate limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 min
    max: Number(process.env.RATE_LIMIT_MAX) || 100, // 100 req/min
  },

  // CORS
  cors: {
    enabled: process.env.CORS_ENABLED !== "false",
    origin: process.env.CORS_ORIGIN || "*",
  },

  // Game (Magic Garden)
  game: {
    origin: process.env.GAME_ORIGIN || "https://magicgarden.gg",
    pageUrl: process.env.GAME_PAGE_URL || "https://magicgarden.gg/r/test",
  },

  // WebSocket reconnection
  websocket: {
    autoReconnect: process.env.WS_AUTO_RECONNECT !== "false",
    maxRetries: Number(process.env.WS_MAX_RETRIES) || 999,
    minDelay: Number(process.env.WS_MIN_DELAY) || 500,
    maxDelay: Number(process.env.WS_MAX_DELAY) || 8000,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    pretty: process.env.NODE_ENV !== "production",
  },

  // Sprites (export & serving)
  sprites: {
    exportDir: process.env.SPRITES_EXPORT_DIR || "./sprites_dump",
    baseUrl: process.env.SPRITES_BASE_URL || "http://localhost:3000",
  },
};
