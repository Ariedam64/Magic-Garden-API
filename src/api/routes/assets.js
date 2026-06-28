// src/api/routes/assets.js

import express from "express";
import { asyncHandler, Errors } from "../middleware/index.js";
import { assetDataService } from "../../services/index.js";
import { spritesRouter } from "./sprites.js";
import { composedRouter } from "./composed.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";

export const assetsRouter = express.Router();

// =====================
// Assets (sprite metadata, cosmetics, audio)
// =====================

const ASSETS_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=300";

// Sprite metadata (JSON list)
assetsRouter.get(
  "/sprite-data",
  asyncHandler(async (req, res) => {
    const options = {
      full: req.query.full === "1",
      search: req.query.search || "",
      cat: req.query.cat || "",
      flat: req.query.flat === "1",
    };
    const data = await assetDataService.getSprites(options);
    const etag = buildWeakEtag("assets:sprite-data", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

assetsRouter.get(
  "/cosmetics",
  asyncHandler(async (req, res) => {
    const options = {
      full: req.query.full === "1",
    };
    const data = await assetDataService.getCosmetics(options);
    const etag = buildWeakEtag("assets:cosmetics", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

assetsRouter.get(
  "/audios",
  asyncHandler(async (req, res) => {
    const data = await assetDataService.getAudio();
    const etag = buildWeakEtag("assets:audios", data.baseUrl, req.originalUrl);
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
      res.status(304).end();
      return;
    }
    applyCacheHeaders(res, { etag, cacheControl: ASSETS_CACHE_CONTROL });
    res.json(data);
  })
);

// GET /assets/proxy?url=<https-magicgarden.gg-url>
// Streams an upstream asset (cosmetic PNGs, audio mp3s, …) through this API so
// clients can fetch + download them cross-origin. Upstream magicgarden.gg
// doesn't set CORS, so the browser blocks direct fetch from third-party
// origins like the explorer page; this proxy adds the headers we need.
// Whitelisted to magicgarden.gg only - not a general open proxy.
assetsRouter.get(
  "/proxy",
  asyncHandler(async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) throw Errors.badRequest("Missing required query param: url");
    if (!/^https:\/\/magicgarden\.gg\/[\w./%-]+$/i.test(url)) {
      throw Errors.badRequest("URL must be a https://magicgarden.gg/ asset");
    }
    const upstream = await fetch(url);
    if (!upstream.ok) throw Errors.notFound(`Upstream HTTP ${upstream.status}`);
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.type(contentType).send(buf);
  })
);

// =====================
// Sprite files (static PNG serving)
// =====================

// Composed sprites (must be before /sprites to avoid :category/:name capturing "composed")
// GET /assets/sprites/composed?key=...&mutations=...
assetsRouter.use("/sprites/composed", composedRouter);

// Individual sprite PNGs: GET /assets/sprites/:category/:name.png
assetsRouter.use("/sprites", spritesRouter);
