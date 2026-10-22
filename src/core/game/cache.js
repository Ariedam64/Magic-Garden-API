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
  cosmeticsSources: [],
  fetchedAt: 0,
  categories: new Map(),
  pending: null,
  generation: 0,
};

// Plafond d'un rafraîchissement complet (~13 fetchs avec le mémo des chunks,
// ~120 sans ; le plus lent observé a pris 82 s). Chaque fetch a son propre
// délai, mais le 2026-10-22 la promesse partagée est quand même restée
// pendante plus d'un quart d'heure sans la moindre erreur : tout ce qui
// l'attendait (cycle jour/nuit, validation des shops de `/stats`) ne
// répondait plus. À l'échéance, la promesse est libérée et un appel suivant
// peut relancer le rafraîchissement.
const REFRESH_DEADLINE_MS = 3 * 60 * 1000;

function cachedBundle() {
  return { mainUrl: cache.mainUrl, mainJs: cache.mainJs, dataSources: cache.dataSources, indexJs: cache.indexJs, uiColorsSources: cache.uiColorsSources, abilityTextSource: cache.abilityTextSource, weathersSource: cache.weathersSource, cosmeticsSources: cache.cosmeticsSources };
}

async function fetchAndStoreBundle(generation) {
  const version = await fetchGameVersion();
  const pageUrl = `${config.game.origin}/version/${version}/index.html`;
  const { mainUrl, mainJs, dataSources, linkedChunks, indexJs, uiColorsSources, abilityTextSource, weathersSource, cosmeticsSources } = await fetchMainBundle(pageUrl);

  // Un rafraîchissement abandonné à l'échéance peut aboutir bien plus tard : il
  // n'écrase pas ce qu'un rafraîchissement plus récent a posé entre-temps.
  if (generation !== cache.generation) return cachedBundle();

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
  cache.cosmeticsSources = cosmeticsSources ?? [];
  cache.fetchedAt = Date.now();

  return cachedBundle();
}

function startRefresh() {
  const generation = ++cache.generation;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Bundle refresh still pending after ${REFRESH_DEADLINE_MS / 1000}s, giving up`)),
      REFRESH_DEADLINE_MS
    );
  });

  const pending = Promise.race([fetchAndStoreBundle(generation), deadline]).finally(() => {
    clearTimeout(timer);
    if (cache.pending === pending) cache.pending = null;
  });

  // Un rafraîchissement de fond n'a personne pour recevoir son erreur.
  pending.catch((err) =>
    logger.warn({ err: err?.message || String(err) }, "Bundle refresh failed")
  );

  cache.pending = pending;
  return pending;
}

/**
 * Récupère le bundle main.js avec cache.
 *
 * Une fois le TTL écoulé, le bundle déjà en mémoire continue d'être servi
 * pendant que le rafraîchissement tourne en fond : il ne change qu'aux mises
 * à jour du jeu, et les routes qui le lisent à chaque requête n'ont pas à
 * attendre le réseau du jeu toutes les 5 minutes. Seul un appel sans bundle
 * (démarrage, `invalidateAllCaches`) attend le téléchargement.
 */
export async function getMainBundle() {
  const now = Date.now();
  const expired = !cache.mainJs || now - cache.fetchedAt > config.cache.bundleTTL;

  if (!expired) return cachedBundle();

  // Évite les requêtes concurrentes
  const pending = cache.pending ?? startRefresh();

  return cache.mainJs ? cachedBundle() : pending;
}

/**
 * Récupère les données d'une catégorie avec cache.
 */
export async function getCategoryCached(categoryName, extractorFn) {
  const { mainUrl, mainJs, dataSources, indexJs, uiColorsSources, abilityTextSource, weathersSource, cosmeticsSources } = await getMainBundle();

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
      data = extractorFn(source, indexJs, uiColorsSources, abilityTextSource, weathersSource, sources, { cosmeticsSources });
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
  cache.cosmeticsSources = [];
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
