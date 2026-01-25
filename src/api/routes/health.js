// src/api/routes/health.js

import express from "express";
import { getCacheStats } from "../../core/game/cache.js";

export const healthRouter = express.Router();

/**
 * GET /health
 * Health check endpoint for monitoring.
 */
healthRouter.get("/", (_req, res) => {
  const cacheStats = getCacheStats();

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    cache: cacheStats,
  });
});

/**
 * GET /health/ready
 * Readiness probe - checks if the service can handle requests.
 */
healthRouter.get("/ready", (_req, res) => {
  const cacheStats = getCacheStats();

  if (cacheStats.hasBundleCached) {
    res.json({ ready: true });
  } else {
    res.status(503).json({ ready: false, reason: "Bundle not yet cached" });
  }
});

/**
 * GET /health/live
 * Liveness probe - checks if the service is running.
 */
healthRouter.get("/live", (_req, res) => {
  res.json({ alive: true });
});
