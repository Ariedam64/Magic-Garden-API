// src/api/routes/live.js

import express from "express";
import { streamLimiter } from "../middleware/index.js";
import { config } from "../../config/index.js";
import { liveDataService } from "../../services/index.js";
import { jsonToCsv, sendCsv, jsonToTsv, sendTsv } from "../../utils/csvConverter.js";

export const liveRouter = express.Router();

// Au-delà de ce retard sans poll réussi, les données servies ne valent plus
// rien : le shop `seed` tourne toutes les 5 minutes. Large pour absorber un
// backoff complet, mais assez court pour que la panne se voie.
const STALE_AFTER_MS = Math.max(config.platform.maxBackoff * 3, 3 * 60 * 1000);

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
  const poller = liveDataService.getStats();

  // Les données live viennent du polling de l'API officielle du jeu : sans
  // WebSocket à surveiller, l'état du poller est le seul indicateur de
  // fraîcheur.
  //
  // `running` ne suffit pas : c'est un simple drapeau posé au démarrage, et il
  // est resté vrai pendant les ~13 h où la boucle était bloquée le 2026-09-20.
  // C'est l'âge du dernier succès qui dit si `/live` sert encore du frais.
  const lastSuccess = poller.lastSuccessAt ? Date.parse(poller.lastSuccessAt) : null;
  const staleFor = Number.isFinite(lastSuccess) ? Date.now() - lastSuccess : null;
  const stale = staleFor === null || staleFor > STALE_AFTER_MS;

  res.status(stale ? 503 : 200).json({
    ok: poller.running && !stale,
    stale,
    staleForMs: staleFor,
    staleAfterMs: STALE_AFTER_MS,
    poller,
    sse: sseStats,
  });
});

// =====================
// CSV & TSV Snapshot endpoints
// =====================

const LIVE_FORMAT_CONFIG = {
  csv: { convert: jsonToCsv, send: sendCsv },
  tsv: { convert: jsonToTsv, send: sendTsv },
};

function buildLiveAllData() {
  const all = liveDataService.getAll();
  const combined = {};

  if (all.weather) {
    combined.weather = { current: all.weather };
  }
  if (all.shops) {
    for (const [shopName, shopData] of Object.entries(all.shops)) {
      combined[shopName] = typeof shopData === "object" && shopData !== null ? shopData : { value: shopData };
    }
  }
  return combined;
}

// Root handlers: GET /live.csv and GET /live.tsv (mounted at app level in server.js)
function makeLiveRootHandler(fmt) {
  const { convert, send } = LIVE_FORMAT_CONFIG[fmt];
  return (_req, res) => {
    send(res, convert(buildLiveAllData()), `live.${fmt}`);
  };
}

export const liveCsvRootHandler = makeLiveRootHandler("csv");
export const liveTsvRootHandler = makeLiveRootHandler("tsv");

// Per-sub-route handlers for each format
for (const fmt of ["csv", "tsv"]) {
  const { convert, send } = LIVE_FORMAT_CONFIG[fmt];

  liveRouter.get(`/weather.${fmt}`, (_req, res) => {
    const weather = liveDataService.getWeather();
    const data = weather && typeof weather === "object"
      ? weather
      : { current: { value: weather } };
    send(res, convert(data), `weather.${fmt}`);
  });

  liveRouter.get(`/shops.${fmt}`, (_req, res) => {
    const shops = liveDataService.getShops();
    const data = shops && typeof shops === "object" ? shops : {};
    send(res, convert(data), `shops.${fmt}`);
  });
}

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
