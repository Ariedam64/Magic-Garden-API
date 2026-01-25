// src/api/routes/docs.js

import express from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load OpenAPI spec
const openapiPath = join(__dirname, "..", "..", "docs", "openapi.yaml");
const swaggerDocument = YAML.load(openapiPath);

export const docsRouter = express.Router();

// Swagger UI options
const options = {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "MG API Documentation",
};

// Serve OpenAPI spec as JSON
docsRouter.get("/openapi.json", (_req, res) => {
  res.json(swaggerDocument);
});

// Serve Swagger UI
docsRouter.use("/", swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
