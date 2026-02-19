// src/api/routes/data.js

import express from "express";
import { asyncHandler } from "../middleware/index.js";
import { gameDataService } from "../../services/index.js";
import { getCacheStats } from "../../core/game/cache.js";
import { getStoredVersionCached } from "../../core/game/versionStorage.js";
import { getTransformedPlants } from "../../services/plantTransformer.js";
import {
  transformDataWithSprites,
  transformWeathersWithSprites,
} from "../../services/dataTransformer.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import {
  jsonToCsv, combinedJsonToCsv, sendCsv,
  jsonToTsv, combinedJsonToTsv, sendTsv,
} from "../../utils/csvConverter.js";

export const dataRouter = express.Router();

// =====================
// Game Data (from bundle)
// =====================

const DATA_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";

const transformedCache = {
  bundleUrl: null,
  spriteVersion: null,
  values: new Map(),
  pending: new Map(),
};

function syncBundleCache(spriteVersion = null) {
  const bundleUrl = getCacheStats().bundleUrl;
  const nextVersion = spriteVersion || null;

  if (bundleUrl && transformedCache.bundleUrl !== bundleUrl) {
    transformedCache.bundleUrl = bundleUrl;
    transformedCache.values.clear();
    transformedCache.pending.clear();
  }

  if (nextVersion && transformedCache.spriteVersion !== nextVersion) {
    transformedCache.spriteVersion = nextVersion;
    transformedCache.values.clear();
    transformedCache.pending.clear();
  }

  return bundleUrl;
}

async function getOrBuildCached(key, spriteVersion, builder) {
  syncBundleCache(spriteVersion);

  if (transformedCache.values.has(key)) {
    return transformedCache.values.get(key);
  }

  if (transformedCache.pending.has(key)) {
    return transformedCache.pending.get(key);
  }

  const promise = (async () => {
    const data = await builder();
    const bundleUrl = syncBundleCache(spriteVersion);
    if (bundleUrl) {
      transformedCache.values.set(key, data);
    }
    return data;
  })();

  transformedCache.pending.set(key, promise);

  try {
    return await promise;
  } finally {
    if (transformedCache.pending.get(key) === promise) {
      transformedCache.pending.delete(key);
    }
  }
}

function buildDataEtag(key, spriteVersion) {
  const bundleUrl = syncBundleCache(spriteVersion);
  if (!bundleUrl) return null;
  return buildWeakEtag("data", key, bundleUrl, spriteVersion || "");
}

function maybeNotModified(req, res, key, spriteVersion) {
  const etag = buildDataEtag(key, spriteVersion);
  if (!etag) return false;
  if (!transformedCache.values.has(key)) return false;

  if (isFresh(req, etag)) {
    applyCacheHeaders(res, { etag, cacheControl: DATA_CACHE_CONTROL });
    res.status(304).end();
    return true;
  }

  return false;
}

function setDataCacheHeaders(res, key, spriteVersion) {
  const etag = buildDataEtag(key, spriteVersion);
  applyCacheHeaders(res, { etag, cacheControl: DATA_CACHE_CONTROL });
}

// Get all data
dataRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "all", spriteVersion)) return;

    const data = await getOrBuildCached("all", spriteVersion, async () => {
      const [plants, pets, items, decor, eggs, mutations, abilities, weathers] = await Promise.all([
        getOrBuildCached("plants", spriteVersion, () =>
          getTransformedPlants({ spriteVersion })
        ),
        getOrBuildCached("pets", spriteVersion, () =>
          gameDataService.getPets().then((data) =>
            transformDataWithSprites(data, "pets", { spriteVersion })
          )
        ),
        getOrBuildCached("items", spriteVersion, () =>
          gameDataService.getItems().then((data) =>
            transformDataWithSprites(data, "items", { spriteVersion })
          )
        ),
        getOrBuildCached("decor", spriteVersion, () =>
          gameDataService.getDecor().then((data) =>
            transformDataWithSprites(data, "decor", { spriteVersion })
          )
        ),
        getOrBuildCached("eggs", spriteVersion, () =>
          gameDataService.getEggs().then((data) =>
            transformDataWithSprites(data, "eggs", { spriteVersion })
          )
        ),
        getOrBuildCached("mutations", spriteVersion, () =>
          gameDataService.getMutations().then((data) =>
            transformDataWithSprites(data, "mutations", { spriteVersion })
          )
        ),
        getOrBuildCached("abilities", spriteVersion, () => gameDataService.getAbilities()),
        getOrBuildCached("weathers", spriteVersion, () =>
          gameDataService.getWeathers().then((data) =>
            transformWeathersWithSprites(data, { spriteVersion })
          )
        ),
      ]);

      return {
        plants,
        pets,
        items,
        decor,
        eggs,
        mutations,
        abilities,
        weathers,
      };
    });

    setDataCacheHeaders(res, "all", spriteVersion);
    res.json(data);
  })
);

dataRouter.get(
  "/plants",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "plants", spriteVersion)) return;

    const data = await getOrBuildCached("plants", spriteVersion, () =>
      getTransformedPlants({ spriteVersion })
    );
    setDataCacheHeaders(res, "plants", spriteVersion);
    res.json(data);
  })
);

dataRouter.get(
  "/pets",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "pets", spriteVersion)) return;

    const transformed = await getOrBuildCached("pets", spriteVersion, () =>
      gameDataService.getPets().then((data) =>
        transformDataWithSprites(data, "pets", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "pets", spriteVersion);
    res.json(transformed);
  })
);

dataRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "items", spriteVersion)) return;

    const transformed = await getOrBuildCached("items", spriteVersion, () =>
      gameDataService.getItems().then((data) =>
        transformDataWithSprites(data, "items", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "items", spriteVersion);
    res.json(transformed);
  })
);

dataRouter.get(
  "/decors",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "decor", spriteVersion)) return;

    const transformed = await getOrBuildCached("decor", spriteVersion, () =>
      gameDataService.getDecor().then((data) =>
        transformDataWithSprites(data, "decor", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "decor", spriteVersion);
    res.json(transformed);
  })
);

dataRouter.get(
  "/eggs",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "eggs", spriteVersion)) return;

    const transformed = await getOrBuildCached("eggs", spriteVersion, () =>
      gameDataService.getEggs().then((data) =>
        transformDataWithSprites(data, "eggs", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "eggs", spriteVersion);
    res.json(transformed);
  })
);

dataRouter.get(
  "/abilities",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "abilities", spriteVersion)) return;

    const data = await getOrBuildCached(
      "abilities",
      spriteVersion,
      () => gameDataService.getAbilities()
    );
    setDataCacheHeaders(res, "abilities", spriteVersion);
    res.json(data);
  })
);

dataRouter.get(
  "/mutations",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "mutations", spriteVersion)) return;

    const transformed = await getOrBuildCached("mutations", spriteVersion, () =>
      gameDataService.getMutations().then((data) =>
        transformDataWithSprites(data, "mutations", { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "mutations", spriteVersion);
    res.json(transformed);
  })
);

dataRouter.get(
  "/weathers",
  asyncHandler(async (req, res) => {
    const spriteVersion = await getStoredVersionCached();
    if (maybeNotModified(req, res, "weathers", spriteVersion)) return;

    const transformed = await getOrBuildCached("weathers", spriteVersion, () =>
      gameDataService.getWeathers().then((data) =>
        transformWeathersWithSprites(data, { spriteVersion })
      )
    );
    setDataCacheHeaders(res, "weathers", spriteVersion);
    res.json(transformed);
  })
);

// =====================
// CSV & TSV endpoints
// =====================

const FORMAT_CONFIG = {
  csv: { convert: jsonToCsv, convertCombined: combinedJsonToCsv, send: sendCsv },
  tsv: { convert: jsonToTsv, convertCombined: combinedJsonToTsv, send: sendTsv },
};

// Category definitions: [routeName, cacheKey, builder(spriteVersion)]
const CATEGORY_DEFS = [
  ["plants", "plants", (sv) => getTransformedPlants({ spriteVersion: sv })],
  ["pets", "pets", (sv) => gameDataService.getPets().then((d) => transformDataWithSprites(d, "pets", { spriteVersion: sv }))],
  ["items", "items", (sv) => gameDataService.getItems().then((d) => transformDataWithSprites(d, "items", { spriteVersion: sv }))],
  ["decors", "decor", (sv) => gameDataService.getDecor().then((d) => transformDataWithSprites(d, "decor", { spriteVersion: sv }))],
  ["eggs", "eggs", (sv) => gameDataService.getEggs().then((d) => transformDataWithSprites(d, "eggs", { spriteVersion: sv }))],
  ["abilities", "abilities", () => gameDataService.getAbilities()],
  ["mutations", "mutations", (sv) => gameDataService.getMutations().then((d) => transformDataWithSprites(d, "mutations", { spriteVersion: sv }))],
  ["weathers", "weathers", (sv) => gameDataService.getWeathers().then((d) => transformWeathersWithSprites(d, { spriteVersion: sv }))],
];

// Build all data (shared by root .csv/.tsv handlers)
async function getAllData(spriteVersion) {
  return getOrBuildCached("all", spriteVersion, async () => {
    const results = await Promise.all(
      CATEGORY_DEFS.map(([, cacheKey, builder]) =>
        getOrBuildCached(cacheKey, spriteVersion, () => builder(spriteVersion))
      )
    );
    const obj = {};
    CATEGORY_DEFS.forEach(([, cacheKey], i) => { obj[cacheKey] = results[i]; });
    return obj;
  });
}

// Root handlers: GET /data.csv and GET /data.tsv (mounted at app level in server.js)
function makeRootHandler(fmt) {
  const { convertCombined, send } = FORMAT_CONFIG[fmt];
  return asyncHandler(async (_req, res) => {
    const spriteVersion = await getStoredVersionCached();
    const data = await getAllData(spriteVersion);
    setDataCacheHeaders(res, "all", spriteVersion);
    send(res, convertCombined(data), `data.${fmt}`);
  });
}

export const dataCsvRootHandler = makeRootHandler("csv");
export const dataTsvRootHandler = makeRootHandler("tsv");

// Register per-category routes for each format
for (const fmt of ["csv", "tsv"]) {
  const { convert, send } = FORMAT_CONFIG[fmt];

  for (const [routeName, cacheKey, builder] of CATEGORY_DEFS) {
    dataRouter.get(
      `/${routeName}.${fmt}`,
      asyncHandler(async (_req, res) => {
        const spriteVersion = await getStoredVersionCached();
        const data = await getOrBuildCached(cacheKey, spriteVersion, () => builder(spriteVersion));
        setDataCacheHeaders(res, cacheKey, spriteVersion);
        send(res, convert(data), `${routeName}.${fmt}`);
      })
    );
  }
}
