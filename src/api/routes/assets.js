// src/api/routes/assets.js

import express from "express";
import { asyncHandler } from "../middleware/index.js";
import { assetDataService } from "../../services/index.js";
import { spritesRouter } from "./sprites.js";

export const assetsRouter = express.Router();

// =====================
// Assets (sprite metadata, cosmetics, audio)
// =====================

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
    res.json(data);
  })
);

assetsRouter.get(
  "/audios",
  asyncHandler(async (_req, res) => {
    const data = await assetDataService.getAudio();
    res.json(data);
  })
);

// =====================
// Sprite files (static PNG serving)
// =====================

// Mount sprite file router under /assets/sprites
// This makes sprites accessible at /assets/sprites/:category/:name.png
assetsRouter.use("/sprites", spritesRouter);
