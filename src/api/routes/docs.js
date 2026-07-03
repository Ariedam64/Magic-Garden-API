// src/api/routes/docs.js

import express from "express";
import { readFileSync } from "node:fs";
import YAML from "yamljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const docsDir = join(__dirname, "..", "..", "docs");

// Load OpenAPI spec once at startup
const openapiDocument = YAML.load(join(docsDir, "openapi.yaml"));

// Custom interactive docs page (landing + endpoint explorer with try-it)
const docsHtml = readFileSync(join(docsDir, "index.html"), "utf8");

export const docsRouter = express.Router();

// Disable caching for docs assets/spec to avoid stale UI behind CDN caches.
docsRouter.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Serve OpenAPI spec as JSON (consumed by the docs page)
docsRouter.get("/openapi.json", (_req, res) => {
  res.json(openapiDocument);
});

// Serve the docs page
docsRouter.get("/", (_req, res) => {
  res.type("html").send(docsHtml);
});
