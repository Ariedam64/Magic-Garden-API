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
 * Résout l'URL de l'index.js du jeu depuis la page.
 *
 * Flow: HTML -> index-*.js
 * (le chemin jusqu'aux données peut ensuite passer par plusieurs chunks
 * imbriqués selon le build du jeu — voir fetchMainBundle/findDataChunk)
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

  logger.debug({ indexUrl }, "Index bundle resolved");

  return { indexUrl, indexJs };
}

// Signature stable présente dans le chunk de données du jeu
const DATA_SIGNATURE = "secondsToHatch";

// Signatures indiquant le chunk contenant les couleurs UI (switch abilities +
// map mutations). Les deux vivent dans le même chunk depuis la maj rolldown,
// mais on ne suppose pas que ça restera vrai — voir findChunksInGraph.
const UI_COLOR_SIGNATURES = ["Ambershine:`rgb(", "Dawnlit:`rgb(", "Thunderstruck:`rgb("];
const UI_COLOR_MIN_HITS = 2;

// Profondeur max de traversée du graphe de chunks (index -> loader -> main -> ...)
const MAX_CHUNK_DEPTH = 4;

/**
 * Parse les chunks référencés dans le tableau __vite__mapDeps du bundle.
 */
function parseViteChunks(js, baseUrl) {
  const match = js.match(/m\.f\|\|\(m\.f=(\[.*?\])\)/);
  if (!match) return [];
  const chunks = [...match[1].matchAll(/"(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const seen = new Set();
  return chunks
    .filter((c) => !seen.has(c) && seen.add(c))
    .map((c) => ({ path: c, url: `${baseUrl}${c}` }));
}

/**
 * Parcourt le graphe de chunks référencés par __vite__mapDeps, niveau par
 * niveau (BFS), à la recherche de plusieurs cibles à la fois — une seule
 * traversée du bundle suffit donc pour localiser le chunk de données ET le
 * chunk des couleurs UI, même s'ils ne sont pas au même endroit.
 *
 * Le build du jeu insère parfois un ou plusieurs chunks intermédiaires
 * (ex: un "Loader") avant le chunk recherché, donc on ne peut pas supposer
 * une profondeur fixe — on parcourt jusqu'à MAX_CHUNK_DEPTH.
 *
 * @param {string} entryJs
 * @param {string} baseUrl
 * @param {{id: string, test: (content: string) => boolean}[]} targets
 * @returns {Promise<Map<string, {url: string, content: string}>>}
 */
async function findChunksInGraph(entryJs, baseUrl, targets) {
  const found = new Map();
  const remaining = new Set(targets.map((t) => t.id));
  const visited = new Set();
  let frontier = parseViteChunks(entryJs, baseUrl);

  for (let depth = 0; depth < MAX_CHUNK_DEPTH && frontier.length && remaining.size; depth++) {
    const ordered = [
      ...frontier.filter((c) => c.path.includes("QuinoaView")),
      ...frontier.filter((c) => !c.path.includes("QuinoaView")),
    ];
    const nextFrontier = [];

    for (const chunk of ordered) {
      if (visited.has(chunk.url)) continue;
      visited.add(chunk.url);

      let content;
      try {
        content = await fetchText(chunk.url);
      } catch {
        continue;
      }

      for (const target of targets) {
        if (remaining.has(target.id) && target.test(content)) {
          logger.info({ id: target.id, url: chunk.url, size: content.length, depth }, "Chunk found");
          found.set(target.id, { url: chunk.url, content });
          remaining.delete(target.id);
        }
      }

      if (!remaining.size) return found;

      for (const sub of parseViteChunks(content, baseUrl)) {
        if (!visited.has(sub.url)) nextFrontier.push(sub);
      }
    }

    frontier = nextFrontier;
  }

  return found;
}

function countHits(content, signatures) {
  return signatures.reduce((n, s) => n + (content.includes(s) ? 1 : 0), 0);
}

/**
 * Récupère le contenu du bundle de données du jeu, ainsi que le chunk
 * contenant les couleurs UI (abilities/mutations) si on le trouve.
 *
 * Tente index.js en premier pour les données ; sinon parcourt le graphe de
 * chunks (__vite__mapDeps, potentiellement sur plusieurs niveaux) à la
 * recherche à la fois du chunk de données et du chunk de couleurs UI.
 */
export async function fetchMainBundle(pageUrl = config.game.pageUrl) {
  const { indexUrl, indexJs } = await resolveMainFromPage(pageUrl);
  const baseUrl = indexUrl.replace(/assets\/[^/]+$/, "");

  const hasData = indexJs.includes(DATA_SIGNATURE);
  const hasUiColors = countHits(indexJs, UI_COLOR_SIGNATURES) >= UI_COLOR_MIN_HITS;

  if (hasData && hasUiColors) {
    return { indexUrl, mainUrl: indexUrl, mainJs: indexJs, indexJs, uiColorsJs: indexJs };
  }

  logger.debug({ indexUrl, hasData, hasUiColors }, "Searching chunk graph for game data / UI colors");

  const targets = [];
  if (!hasData) {
    targets.push({ id: "data", test: (c) => c.includes(DATA_SIGNATURE) });
  }
  if (!hasUiColors) {
    targets.push({ id: "uiColors", test: (c) => countHits(c, UI_COLOR_SIGNATURES) >= UI_COLOR_MIN_HITS });
  }

  const chunks = await findChunksInGraph(indexJs, baseUrl, targets);

  const dataChunk = hasData ? { url: indexUrl, content: indexJs } : chunks.get("data");
  const uiColorsChunk = hasUiColors ? { url: indexUrl, content: indexJs } : chunks.get("uiColors");

  if (!dataChunk) {
    throw new Error("Game data chunk not found in bundle graph");
  }
  if (!uiColorsChunk) {
    logger.warn("UI colors chunk not found in bundle graph (abilities/mutations will use default colors)");
  }

  return {
    indexUrl,
    mainUrl: dataChunk.url,
    mainJs: dataChunk.content,
    indexJs,
    uiColorsJs: uiColorsChunk?.content ?? null,
  };
}
