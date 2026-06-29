// src/api/routes/index.js

export { dataRouter, dataCsvRootHandler, dataTsvRootHandler } from "./data.js";
export { liveRouter, liveCsvRootHandler, liveTsvRootHandler } from "./live.js";
export { healthRouter } from "./health.js";
export { docsRouter } from "./docs.js";
export { spritesRouter } from "./sprites.js";
export { assetsRouter } from "./assets.js";
export { statsRouter } from "./stats.js";
// Hidden, unlinked weather explorer (not advertised in root/docs/openapi).
export { weatherPredictionRouter } from "./weatherPrediction.js";
