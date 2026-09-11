// src/api/routes/health.js

import express from "express";
import { getCacheStats } from "../../core/game/cache.js";
import { getColorCoverage } from "../../core/game/bundle/colors.js";
import { isAnimationExportRunning } from "../../services/animationSync.js";
import { getDataCoverage } from "./data.js";
import { weatherStationService } from "../../services/weatherStation.js";

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
    // Le rendu des boucles de pets prend une dizaine de minutes dans un
    // processus fils : sans ça, rien ne le signale hors des logs.
    animations: { exportRunning: isAnimationExportRunning() },
    // Couverture des couleurs extraites du bundle (abilities/mutations).
    // `matched: 0` = le bloc de couleurs a encore bougé côté jeu.
    colors: getColorCoverage(),
    // Catégories de `/data` que le bundle courant ne permet plus de construire.
    // Elles sont omises de l'agrégat au lieu de le faire tomber, donc sans ça
    // une catégorie perdue ne se verrait plus que dans les logs.
    data: getDataCoverage(),
    // Santé du moteur de prédiction météo : une chute de `accuracy_24h.pct` ou
    // un `drift.aligned: false` signale que le jeu a changé son scheduler.
    weatherStation: weatherStationService.getHealthSnapshot(),
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
