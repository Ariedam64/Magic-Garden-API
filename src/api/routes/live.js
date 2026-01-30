// src/api/routes/live.js

import express from "express";
import { streamLimiter } from "../middleware/index.js";
import { liveDataService } from "../../services/index.js";

export const liveRouter = express.Router();

const sseStats = {
  activeConnections: 0,
  activeByStream: {
    all: 0,
    weather: 0,
    shops: 0,
  },
  totalConnections: 0,
  eventsSent: 0,
  lastEventAt: null,
};

// =====================
// SSE Helpers
// =====================

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  sseStats.eventsSent += 1;
  sseStats.lastEventAt = new Date().toISOString();
}

function registerSseConnection(streamKey, req, res) {
  sseStats.activeConnections += 1;
  sseStats.activeByStream[streamKey] += 1;
  sseStats.totalConnections += 1;

  req.on("close", () => {
    sseStats.activeConnections = Math.max(0, sseStats.activeConnections - 1);
    sseStats.activeByStream[streamKey] = Math.max(0, sseStats.activeByStream[streamKey] - 1);
    res.end();
  });
}

// =====================
// Snapshot endpoints
// =====================

// GET /live - All live data
liveRouter.get("/", (_req, res) => {
  res.json(liveDataService.getAll());
});

// GET /live/weather
liveRouter.get("/weather", (_req, res) => {
  res.json({ weather: liveDataService.getWeather() });
});

// GET /live/shops
liveRouter.get("/shops", (_req, res) => {
  res.json(liveDataService.getShops());
});

// GET /live/health
liveRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    sse: sseStats,
  });
});

// =====================
// SSE Stream endpoints
// =====================

// GET /live/stream
liveRouter.get("/stream", streamLimiter, (req, res) => {
  sseHeaders(res);
  registerSseConnection("all", req, res);

  // Send initial state
  sseSend(res, "weather", { weather: liveDataService.getWeather() });
  sseSend(res, "shops", liveDataService.getShops());

  // Subscribe to changes
  const unsubscribeWeather = liveDataService.onWeatherChange((weather) => {
    sseSend(res, "weather", { weather });
  });

  const unsubscribeShops = liveDataService.onShopsChange((shops) => {
    sseSend(res, "shops", shops);
  });

  req.on("close", () => {
    unsubscribeWeather();
    unsubscribeShops();
  });
});

// GET /live/weather/stream
liveRouter.get("/weather/stream", streamLimiter, (req, res) => {
  sseHeaders(res);
  registerSseConnection("weather", req, res);

  // Send initial state
  sseSend(res, "weather", { weather: liveDataService.getWeather() });

  // Subscribe to changes
  const unsubscribe = liveDataService.onWeatherChange((weather) => {
    sseSend(res, "weather", { weather });
  });

  req.on("close", () => {
    unsubscribe();
  });
});

// GET /live/shops/stream
liveRouter.get("/shops/stream", streamLimiter, (req, res) => {
  sseHeaders(res);
  registerSseConnection("shops", req, res);

  // Send initial state
  sseSend(res, "shops", liveDataService.getShops());

  // Subscribe to changes
  const unsubscribe = liveDataService.onShopsChange((shops) => {
    sseSend(res, "shops", shops);
  });

  req.on("close", () => {
    unsubscribe();
  });
});
