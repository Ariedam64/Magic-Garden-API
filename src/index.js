// src/index.js
// Main entry point for MG API

import fs from "node:fs/promises";
import { config } from "./config/index.js";
import { logger } from "./logger/index.js";
import { startApiServer } from "./api/server.js";
import { MagicGardenConnection } from "./core/websocket/connection.js";
import { liveDataService } from "./services/index.js";
import { registerSpriteSyncListener } from "./services/spriteSync.js";
import { exportSpritesToDisk } from "./assets/sprites/exportSpritesToDisk.js";

// =====================
// 1) Start API Server
// =====================

const { server } = startApiServer({ port: config.server.port });

// =====================
// 2) Connect to Magic Garden WebSocket
// =====================

const mg = new MagicGardenConnection({
  origin: config.game.origin,
  autoReconnect: config.websocket.autoReconnect,
  maxRetries: config.websocket.maxRetries,
  minDelay: config.websocket.minDelay,
  maxDelay: config.websocket.maxDelay,
});

// Register sprite sync listener for version mismatch handling
registerSpriteSyncListener(mg);

mg.on("open", (status) => {
  logger.info({ roomId: status.roomId, version: status.version }, "Connected to Magic Garden");
});

mg.on("message", (raw) => {
  // Feed live data service with WebSocket messages
  liveDataService.handleRawMessage(raw);
});

mg.on("close", ({ code, reason }) => {
  logger.warn({ code, reason }, "Magic Garden connection closed");
});

mg.on("reconnect", ({ attempt, delay, closeCode }) => {
  logger.info({ attempt, delay, closeCode }, "Scheduling reconnect");
});

mg.on("error", (err) => {
  logger.error({ error: err?.message }, "Magic Garden connection error");
});

// Connect
await mg.connect();

// =====================
// 3) Graceful Shutdown
// =====================

function shutdown() {
  logger.info("Shutting down...");

  try {
    mg.stop();
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

export { mg, server };
