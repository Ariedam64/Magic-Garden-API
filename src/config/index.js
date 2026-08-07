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
    max: Number(process.env.RATE_LIMIT_MAX) || 60, // 60 req/min
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

  // API officielle du jeu (`/platform/v1/*`), source des données live.
  platform: {
    // Cadence de base du polling. L'amont répond `public, max-age=30` :
    // descendre plus bas ne donne pas de données plus fraîches. Le poller se
    // réveille de toute façon pile sur les échéances `nextRestockAt`.
    pollInterval: Number(process.env.PLATFORM_POLL_INTERVAL) || 15 * 1000,
    // Cadence resserrée le temps qu'un restock annoncé apparaisse en amont.
    fastPollInterval: Number(process.env.PLATFORM_FAST_POLL_INTERVAL) || 5 * 1000,
    // Plafond du backoff exponentiel quand l'API officielle est injoignable.
    maxBackoff: Number(process.env.PLATFORM_MAX_BACKOFF) || 60 * 1000,
    timeout: Number(process.env.PLATFORM_TIMEOUT) || 8 * 1000,
    userAgent: process.env.PLATFORM_USER_AGENT || "MG-API/2.1 (+https://mg-api.ariedam.fr)",
  },

  // Surveillance de la version du jeu : remplace les codes de fermeture
  // WebSocket 4700/4710, qui étaient jusqu'ici notre signal de mise à jour.
  versionWatch: {
    enabled: process.env.VERSION_WATCH_ENABLED !== "false",
    interval: Number(process.env.VERSION_WATCH_INTERVAL) || 60 * 1000,
    // Un redémarrage après resync garantit un état propre (pm2 relance). Les
    // caches sont tous indexés par version et se régénèrent seuls, donc c'est
    // désactivable si l'on préfère ne pas couper les flux SSE en cours.
    restartAfterSync: process.env.VERSION_WATCH_RESTART !== "false",
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

  // Animations de pets (boucles WebP/GIF rendues depuis rive/pets.riv).
  // Ces fichiers pèsent ~1 Mo par espèce et coûtent quelques minutes de CPU à
  // (re)générer : c'est un travail de fond, déclenché quand le .riv change.
  animations: {
    enabled: process.env.PET_ANIMATIONS_ENABLED !== "false",
    // WebP d'abord : alpha 8 bits et ~2x plus compact que le GIF. Ajouter
    // "gif" double le volume sur disque.
    formats: (process.env.PET_ANIMATIONS_FORMATS || "webp")
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean),
    // Hauteur voulue du sujet (pas du canvas) : c'est ce qui rend les espèces
    // comparables entre elles.
    height: Number(process.env.PET_ANIMATIONS_HEIGHT) || 256,
    // Niveau de near-lossless du WebP (1-100). Plus bas = plus compact et plus
    // approximatif ; 20 rend une erreur maximale de 8/255, invisible à l'œil.
    // Ce n'est pas une qualité lossy : voir encodeAnimation pour pourquoi le
    // lossy est inadapté à ces aplats vectoriels.
    quality: Number(process.env.PET_ANIMATIONS_QUALITY) || 20,
    // Clips exportés, parmi ceux déclarés dans exportPetAnimations.js.
    clips: (process.env.PET_ANIMATIONS_CLIPS || "idle,walk,eat,sleep")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  },

  // History (SQLite persistence of shops/weather)
  history: {
    enabled: process.env.HISTORY_ENABLED !== "false",
    dbPath: process.env.HISTORY_DB_PATH || "./data/history.sqlite",
    // Append-only NDJSON safety-net logs (one file per UTC month).
    eventsEnabled: process.env.HISTORY_EVENTS_ENABLED !== "false",
    eventsDir: process.env.HISTORY_EVENTS_DIR || "./data/events",
  },
};
