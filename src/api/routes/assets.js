// src/api/routes/assets.js

import express from "express";
import { asyncHandler } from "../middleware/index.js";
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

// =====================
// Sprite files (static PNG serving)
// =====================

// Composed sprites (must be before /sprites to avoid :category/:name capturing "composed")
// GET /assets/sprites/composed?key=...&mutations=...
assetsRouter.use("/sprites/composed", composedRouter);

// Individual sprite PNGs: GET /assets/sprites/:category/:name.png
assetsRouter.use("/sprites", spritesRouter);
