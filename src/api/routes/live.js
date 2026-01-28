// src/api/routes/live.js

import express from "express";
import { streamLimiter } from "../middleware/index.js";
import { liveDataService } from "../../services/index.js";

export const liveRouter = express.Router();

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

// =====================
// SSE Stream endpoints
// =====================

// GET /live/stream
liveRouter.get("/stream", streamLimiter, (req, res) => {
  sseHeaders(res);

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
    res.end();
  });
});

// GET /live/weather/stream
liveRouter.get("/weather/stream", streamLimiter, (req, res) => {
  sseHeaders(res);

  // Send initial state
  sseSend(res, "weather", { weather: liveDataService.getWeather() });

  // Subscribe to changes
  const unsubscribe = liveDataService.onWeatherChange((weather) => {
    sseSend(res, "weather", { weather });
  });

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});

// GET /live/shops/stream
liveRouter.get("/shops/stream", streamLimiter, (req, res) => {
  sseHeaders(res);

  // Send initial state
  sseSend(res, "shops", liveDataService.getShops());

  // Subscribe to changes
  const unsubscribe = liveDataService.onShopsChange((shops) => {
    sseSend(res, "shops", shops);
  });

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});
