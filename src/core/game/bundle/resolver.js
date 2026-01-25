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

/**
 * Récupère le contenu du bundle main.js.
 */
export async function fetchMainBundle(pageUrl = config.game.pageUrl) {
  const { indexUrl, mainUrl } = await resolveMainFromPage(pageUrl);

  logger.debug({ mainUrl }, "Fetching main bundle");

  const mainJs = await fetchText(mainUrl);

  logger.info({ mainUrl, size: mainJs.length }, "Main bundle fetched");

  return { indexUrl, mainUrl, mainJs };
}
