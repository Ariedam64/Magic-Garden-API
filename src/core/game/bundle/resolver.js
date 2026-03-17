// src/core/game/bundle/resolver.js

import { config } from "../../../config/index.js";
import { logger } from "../../../logger/index.js";

/**
 * Fetch une URL et retourne le texte.
 */
export async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "MG-API/1.0",
      accept: "*/*",
      "cache-control": "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} -> ${url}`);
  }

  return res.text();
}

/**
 * Résout l'URL du bundle main.js depuis la page du jeu.
 *
 * Flow: HTML -> index-*.js -> main-*.js
 */
export async function resolveMainFromPage(pageUrl = config.game.pageUrl) {
  logger.debug({ pageUrl }, "Resolving main bundle from page");

  // 1. Fetch le HTML de la page
  const html = await fetchText(pageUrl);

  // 2. Extraire la référence vers index-*.js
  const indexRel = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
  if (!indexRel) {
    throw new Error("index-*.js not found in HTML");
  }

  const indexUrl = new URL(indexRel, pageUrl).href;

  // 3. Fetch index.js
  const indexJs = await fetchText(indexUrl);

  // 4. Extraire la référence vers main-*.js
  const mainRel = indexJs.match(/assets\/main-[^"']+\.js/)?.[0];
  if (!mainRel) {
    throw new Error("main-*.js not found in index");
  }

  // 5. Construire l'URL absolue
  const base = indexUrl.replace(/\/assets\/index-[^/]+\.js(\?.*)?$/, "/");
  const mainUrl = new URL(mainRel, base).href;

  logger.debug({ indexUrl, mainUrl }, "Bundle URLs resolved");

  return { indexUrl, mainUrl };
}

// Signature stable présente dans le chunk de données du jeu
const DATA_SIGNATURE = "secondsToHatch";

/**
 * Parse les chunks référencés dans le tableau __vite__mapDeps du bundle.
 */
function parseViteChunks(mainJs, baseUrl) {
  const match = mainJs.match(/m\.f\|\|\(m\.f=(\[.*?\])\)/);
  if (!match) return [];
  const chunks = [...match[1].matchAll(/"(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const seen = new Set();
  return chunks
    .filter((c) => !seen.has(c) && seen.add(c))
    .map((c) => ({ path: c, url: `${baseUrl}${c}` }));
}

/**
 * Cherche le chunk contenant les données du jeu parmi les chunks listés.
 * Essaie d'abord les chunks "QuinoaView" (heuristique stable), puis tous les autres.
 */
async function findDataChunk(mainJs, baseUrl) {
  const chunks = parseViteChunks(mainJs, baseUrl);
  const ordered = [
    ...chunks.filter((c) => c.path.includes("QuinoaView")),
    ...chunks.filter((c) => !c.path.includes("QuinoaView")),
  ];

  for (const chunk of ordered) {
    let content;
    try {
      content = await fetchText(chunk.url);
    } catch {
      continue;
    }
    if (content.includes(DATA_SIGNATURE)) {
      logger.info({ url: chunk.url, size: content.length }, "Data chunk found");
      return { dataUrl: chunk.url, dataJs: content };
    }
  }

  return null;
}

/**
 * Récupère le contenu du bundle de données du jeu.
 * Tente main.js en premier ; si les données n'y sont pas (code-splitting),
 * cherche le chunk contenant les données dans __vite__mapDeps.
 */
export async function fetchMainBundle(pageUrl = config.game.pageUrl) {
  const { indexUrl, mainUrl } = await resolveMainFromPage(pageUrl);

  logger.debug({ mainUrl }, "Fetching main bundle");

  const mainJs = await fetchText(mainUrl);

  logger.info({ mainUrl, size: mainJs.length }, "Main bundle fetched");

  if (mainJs.includes(DATA_SIGNATURE)) {
    return { indexUrl, mainUrl, mainJs };
  }

  // v125+ : les données sont dans un chunk séparé
  logger.info({ mainUrl }, "Game data not in main bundle, searching chunks");
  const baseUrl = mainUrl.replace(/assets\/[^/]+$/, "");
  const chunk = await findDataChunk(mainJs, baseUrl);

  if (chunk) {
    return { indexUrl, mainUrl: chunk.dataUrl, mainJs: chunk.dataJs };
  }

  logger.warn({ mainUrl }, "Data chunk not found, falling back to main bundle");
  return { indexUrl, mainUrl, mainJs };
}
