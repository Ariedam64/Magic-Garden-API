// src/api/server.js

import express from "express";
import helmet from "helmet";

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";

import {
  corsMiddleware,
  apiLimiter,
  requestLogger,
  errorHandler,
} from "./middleware/index.js";

import { dataRouter, liveRouter, healthRouter, docsRouter, assetsRouter } from "./routes/index.js";

/**
 * Crée l'application Express avec tous les middlewares.
 */
export function createApp() {
  const app = express();

  // Trust proxy (Nginx)
  app.set("trust proxy", 1);

  // =====================
  // Security & Global Middlewares
  // =====================

  // Helmet pour les headers de sécurité
  app.use(helmet({
    contentSecurityPolicy: false, // API JSON, pas de HTML
  }));

  // CORS
  if (config.cors.enabled) {
    app.use(corsMiddleware);
  }

  // Rate limiting
  if (config.rateLimit.enabled) {
    app.use(apiLimiter);
  }

  // Request logging
  app.use(requestLogger);

  // JSON parsing
  app.use(express.json());

  // =====================
  // Routes
  // =====================

  // Health check (pas de rate limit)
  app.use("/health", healthRouter);

  // API Documentation (Swagger UI)
  app.use("/docs", docsRouter);

  // Data routes (static game data + assets)
  app.use("/data", dataRouter);

  // Live routes (WebSocket data via SSE)
  app.use("/live", liveRouter);

  // Assets routes (cosmetics, audios, etc.)
  app.use("/assets", assetsRouter);

  // Root endpoint
  app.get("/", (_req, res) => {
    res.json({
      name: "MG API",
      version: "2.0.0",
      description: "Unofficial Magic Garden API",
      endpoints: {
        data: "/data",
        live: "/live",
        health: "/health",
        docs: "/docs",
      },
    });
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Démarre le serveur API.
 */
export function startApiServer({ port = config.server.port } = {}) {
  const app = createApp();

  const server = app.listen(port, () => {
    logger.info({ port }, "API server started");
  });

  return { app, server };
}
