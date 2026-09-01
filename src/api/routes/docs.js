// src/api/routes/docs.js

import express from "express";
import { readFileSync } from "node:fs";
import YAML from "yamljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getShopTypes } from "../../services/historyQueries.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const docsDir = join(__dirname, "..", "..", "docs");

// Load OpenAPI spec once at startup
const openapiDocument = YAML.load(join(docsDir, "openapi.yaml"));

const SHOP_PARAM_NAME = "shop";

let specCache = { key: null, spec: openapiDocument };

/**
 * Remplace l'enum du paramètre `shop` par la liste réelle des shops du jeu,
 * pour que la doc (et le sélecteur de l'explorer) ne périme pas quand le jeu
 * en ajoute un.
 */
function withShopEnum(shopTypes) {
  const spec = structuredClone(openapiDocument);

  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      for (const param of operation?.parameters ?? []) {
        if (param?.name === SHOP_PARAM_NAME && Array.isArray(param.schema?.enum)) {
          param.schema.enum = [...shopTypes];
        }
      }
    }
  }

  return spec;
}

async function getSpec() {
  const shopTypes = await getShopTypes();
  const key = shopTypes.join(",");
  if (specCache.key !== key) {
    specCache = { key, spec: withShopEnum(shopTypes) };
  }
  return specCache.spec;
}

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
docsRouter.get("/openapi.json", async (_req, res) => {
  res.json(await getSpec());
});

// Serve the docs page
docsRouter.get("/", (_req, res) => {
  res.type("html").send(docsHtml);
});
