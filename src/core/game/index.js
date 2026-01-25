// src/core/game/index.js

export { fetchGameVersion, invalidateVersionCache } from "./version.js";

export {
  getMainBundle,
  getCategoryCached,
  invalidateAllCaches,
  getCacheStats,
} from "./cache.js";

export * from "./bundle/index.js";
