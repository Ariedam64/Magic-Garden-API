// src/core/game/cache.js

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { fetchMainBundle } from "./bundle/resolver.js";
import { setLinkedChunks } from "../extractors/sandbox.js";
import { clearEnumCaches } from "./bundle/sandbox.js";
import { clearSpriteMappingCache } from "./bundle/spriteMapping.js";
import { fetchGameVersion } from "./version.js";

/**
 * Cache pour le bundle et les catégories extraites.
 */
const cache = {
  mainUrl: null,
  mainJs: null,
  dataSources: null,
  indexJs: null,
  uiColorsSources: null,
  abilityTextSource: null,
  weathersSource: null,
  fetchedAt: 0,
  categories: new Map(),
  pending: null,
};

/**
 * Récupère le bundle main.js avec cache.
 */
export async function getMainBundle() {
  const now = Date.now();
  const expired = !cache.mainJs || now - cache.fetchedAt > config.cache.bundleTTL;

  if (!expired) {
    return { mainUrl: cache.mainUrl, mainJs: cache.mainJs, dataSources: cache.dataSources, indexJs: cache.indexJs, uiColorsSources: cache.uiColorsSources, abilityTextSource: cache.abilityTextSource, weathersSource: cache.weathersSource };
  }

  // Évite les requêtes concurrentes
  if (cache.pending) {
    return cache.pending;
  }

  cache.pending = (async () => {
    try {
      const version = await fetchGameVersion();
      const pageUrl = `${config.game.origin}/version/${version}/index.html`;
      const { mainUrl, mainJs, dataSources, linkedChunks, indexJs, uiColorsSources, abilityTextSource, weathersSource } = await fetchMainBundle(pageUrl);

      // Si la version a changé, flush les caches
      if (cache.mainUrl && cache.mainUrl !== mainUrl) {
        logger.info({ oldUrl: cache.mainUrl, newUrl: mainUrl }, "Bundle version changed, clearing caches");
        cache.categories.clear();
        clearEnumCaches();
        clearSpriteMappingCache();
      }

      cache.mainUrl = mainUrl;
      cache.mainJs = mainJs;
      cache.dataSources = dataSources;
      setLinkedChunks(linkedChunks);
      cache.indexJs = indexJs;
      cache.uiColorsSources = uiColorsSources;
      cache.abilityTextSource = abilityTextSource;
      cache.weathersSource = weathersSource;
      cache.fetchedAt = Date.now();

      return { mainUrl, mainJs, dataSources, indexJs, uiColorsSources, abilityTextSource, weathersSource };
    } finally {
      cache.pending = null;
    }
  })();

  return cache.pending;
}

/**
 * Récupère les données d'une catégorie avec cache.
 */
export async function getCategoryCached(categoryName, extractorFn) {
  const { mainUrl, mainJs, dataSources, indexJs, uiColorsSources, abilityTextSource, weathersSource } = await getMainBundle();

  const existing = cache.categories.get(categoryName);
  if (existing && existing.mainUrl === mainUrl) {
    logger.debug({ category: categoryName }, "Category cache hit");
    return existing.data;
  }

  logger.debug({ category: categoryName }, "Category cache miss, extracting");

  // Depuis 1324 les catalogues sont répartis sur plusieurs chunks de données :
  // chaque extracteur essaie les chunks dans l'ordre et garde le premier qui
  // aboutit. Si aucun n'aboutit, c'est l'erreur du chunk principal qui remonte.
  const sources = dataSources?.length ? dataSources : [mainJs];
  let data;
  let firstError = null;
  for (const source of sources) {
    try {
      data = extractorFn(source, indexJs, uiColorsSources, abilityTextSource, weathersSource, sources);
      firstError = null;
      break;
    } catch (err) {
      firstError ??= err;
    }
  }
  if (firstError) throw firstError;

  cache.categories.set(categoryName, {
    mainUrl,
    data,
    createdAt: Date.now(),
  });

  return data;
}

/**
 * Invalide tous les caches.
 */
export function invalidateAllCaches() {
  cache.mainUrl = null;
  cache.mainJs = null;
  cache.dataSources = null;
  cache.indexJs = null;
  cache.uiColorsSources = null;
  cache.abilityTextSource = null;
  cache.weathersSource = null;
  cache.fetchedAt = 0;
  cache.categories.clear();
  clearEnumCaches();
  clearSpriteMappingCache();
  logger.info("All caches invalidated");
}

/**
 * Retourne les stats du cache.
 */
export function getCacheStats() {
  return {
    hasBundleCached: !!cache.mainJs,
    bundleUrl: cache.mainUrl,
    bundleFetchedAt: cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null,
    bundleAge: cache.fetchedAt ? Date.now() - cache.fetchedAt : null,
    categoriesCached: Array.from(cache.categories.keys()),
  };
}
