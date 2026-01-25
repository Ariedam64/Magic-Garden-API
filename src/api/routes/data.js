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

// Get all data
dataRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [plants, pets, items, decor, eggs, mutations, abilities] = await Promise.all([
      getTransformedPlants(),
      gameDataService.getPets().then(data => transformDataWithSprites(data, "pets")),
      gameDataService.getItems().then(data => transformDataWithSprites(data, "items")),
      gameDataService.getDecor().then(data => transformDataWithSprites(data, "decor")),
      gameDataService.getEggs().then(data => transformDataWithSprites(data, "eggs")),
      gameDataService.getMutations().then(data => transformDataWithSprites(data, "mutations")),
      gameDataService.getAbilities(),
    ]);

    res.json({
      plants,
      pets,
      items,
      decor,
      eggs,
      mutations,
      abilities,
    });
  })
);

dataRouter.get(
  "/plants",
  asyncHandler(async (_req, res) => {
    const data = await getTransformedPlants();
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
  "/items",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getItems();
    const transformed = transformDataWithSprites(data, "items");
    res.json(transformed);
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
  "/eggs",
  asyncHandler(async (_req, res) => {
    const data = await gameDataService.getEggs();
    const transformed = transformDataWithSprites(data, "eggs");
    res.json(transformed);
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

