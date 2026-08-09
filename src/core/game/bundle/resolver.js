// src/core/game/bundle/resolver.js

import { config } from "../../../config/index.js";
import { logger } from "../../../logger/index.js";
import { definesColorsFor } from "./colors.js";
import { ABILITY_COLOR_NAMES, MUTATION_COLOR_NAMES, COLOR_MIN_HITS } from "./colorNames.js";

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

// Les couleurs d'abilities et de mutations sont cherchées séparément : elles
// cohabitent dans le même chunk aujourd'hui, mais elles ont déjà migré
// indépendamment (main.js -> index.js -> chunk dédié -> chunk de localisation),
// donc on ne suppose pas qu'elles restent ensemble.
//
// Le test n'est pas une signature textuelle mais l'extraction réelle : un chunk
// n'est retenu que si on sait en tirer des couleurs. C'est ce qui rend la
// détection insensible aux changements de syntaxe du bundle.
const COLOR_TARGETS = [
  { id: "abilityColors", names: ABILITY_COLOR_NAMES },
  { id: "mutationColors", names: MUTATION_COLOR_NAMES },
];

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

/**
 * Récupère le contenu du bundle de données du jeu, ainsi que les chunks
 * contenant les couleurs UI (abilities/mutations).
 *
 * Tente index.js en premier ; sinon parcourt le graphe de chunks
 * (__vite__mapDeps, potentiellement sur plusieurs niveaux) à la recherche du
 * chunk de données et des chunks de couleurs, en une seule traversée.
 *
 * `uiColorsSources` est une liste (dédupliquée) : abilities et mutations
 * peuvent vivre dans deux chunks différents, et les extracteurs essaient
 * chaque source à leur tour.
 */
export async function fetchMainBundle(pageUrl = config.game.pageUrl) {
  const { indexUrl, indexJs } = await resolveMainFromPage(pageUrl);
  const baseUrl = indexUrl.replace(/assets\/[^/]+$/, "");

  const hasData = indexJs.includes(DATA_SIGNATURE);
  const inIndex = COLOR_TARGETS.filter((t) => definesColorsFor(indexJs, t.names, COLOR_MIN_HITS));

  const targets = [];
  if (!hasData) {
    targets.push({ id: "data", test: (c) => c.includes(DATA_SIGNATURE) });
  }
  for (const target of COLOR_TARGETS) {
    if (inIndex.includes(target)) continue;
    targets.push({ id: target.id, test: (c) => definesColorsFor(c, target.names, COLOR_MIN_HITS) });
  }

  const chunks = targets.length ? await findChunksInGraph(indexJs, baseUrl, targets) : new Map();

  const dataChunk = hasData ? { url: indexUrl, content: indexJs } : chunks.get("data");
  if (!dataChunk) {
    throw new Error("Game data chunk not found in bundle graph");
  }

  const uiColorsSources = [];
  const seen = new Set();
  for (const target of COLOR_TARGETS) {
    const chunk = inIndex.includes(target) ? { url: indexUrl, content: indexJs } : chunks.get(target.id);
    if (!chunk) {
      logger.error({ target: target.id }, "Color chunk not found in bundle graph (default colors will be used)");
      continue;
    }
    if (seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    uiColorsSources.push(chunk.content);
  }

  return {
    indexUrl,
    mainUrl: dataChunk.url,
    mainJs: dataChunk.content,
    indexJs,
    uiColorsSources,
  };
}
