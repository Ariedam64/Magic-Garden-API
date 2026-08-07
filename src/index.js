// src/index.js
// Main entry point for MG API

import { config } from "./config/index.js";
import { logger } from "./logger/index.js";
import { startApiServer } from "./api/server.js";
import { startHistoryRecorder, stopHistoryRecorder } from "./services/index.js";
import { startLivePoller, stopLivePoller } from "./services/livePoller.js";
import { startVersionWatcher, stopVersionWatcher } from "./services/spriteSync.js";

// =====================
// 1) Start API Server
// =====================

const { server } = startApiServer({ port: config.server.port });

// =====================
// 2) Live data from the game's official API
// =====================
//
// Les shops et la météo viennent de `/platform/v1/{shops,weather}` : plus besoin
// de rejoindre une room du jeu en WebSocket pour les lire.

startLivePoller();

// Suit la version du jeu pour resynchroniser les sprites après une mise à jour
// (ce que signalaient auparavant les codes de fermeture WebSocket 4700/4710).
startVersionWatcher();

// =====================
// 3) History recorder (SQLite persistence of shops/weather)
// =====================

if (config.history.enabled) {
  try {
    startHistoryRecorder();
  } catch (err) {
    logger.error({ error: err?.message }, "Failed to start history recorder");
  }
}

logger.info({ port: config.server.port }, "MG API ready");

// =====================
// 4) Graceful Shutdown
// =====================

function shutdown() {
  logger.info("Shutting down...");

  try {
    stopHistoryRecorder();
  } catch {
    // Ignore
  }

  try {
    stopLivePoller();
  } catch {
    // Ignore
  }

  try {
    stopVersionWatcher();
  } catch {
    // Ignore
  }

  try {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  } catch {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// =====================
// Export for external use
// =====================

export { server };
