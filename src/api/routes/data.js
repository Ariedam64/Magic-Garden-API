// src/api/routes/data.js

import express from "express";
import { asyncHandler, Errors } from "../middleware/index.js";
import { gameDataService, assetDataService } from "../../services/index.js";
import { getTransformedPlants } from "../../services/plantTransformer.js";
import { transformDataWithSprites } from "../../services/dataTransformer.js";

export const dataRouter = express.Router();

// =====================
// Game Data (from bundle)
// =====================

dataRouter.get(
  "/plants",
  asyncHandler(async (_req, res) => {
    const data = await getTransformedPlants();
    res.json(data);
  })
);

dataRouter.get(
  "/plants/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getPlants();
    res.json(data);
  })
);

dataRouter.get(
  "/pets",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getPets();
    const transformed = transformDataWithSprites(data, "pets");
    res.json(transformed);
  })
);

dataRouter.get(
  "/pets/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getPets();
    res.json(data);
  })
);

dataRouter.get(
  "/items",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getItems();
    const transformed = transformDataWithSprites(data, "items");
    res.json(transformed);
  })
);

dataRouter.get(
  "/items/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getItems();
    res.json(data);
  })
);

dataRouter.get(
  "/decor",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getDecor();
    const transformed = transformDataWithSprites(data, "decor");
    res.json(transformed);
  })
);

dataRouter.get(
  "/decor/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getDecor();
    res.json(data);
  })
);

dataRouter.get(
  "/eggs",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getEggs();
    const transformed = transformDataWithSprites(data, "eggs");
    res.json(transformed);
  })
);

dataRouter.get(
  "/eggs/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getEggs();
    res.json(data);
  })
);

dataRouter.get(
  "/abilities",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getAbilities();
    res.json(data);
  })
);

dataRouter.get(
  "/mutations",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getMutations();
    const transformed = transformDataWithSprites(data, "mutations");
    res.json(transformed);
  })
);

dataRouter.get(
  "/mutations/raw",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getMutations();
    res.json(data);
  })
);