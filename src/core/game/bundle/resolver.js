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
// Le jeu ajoute régulièrement un niveau d'indirection à l'entrée (v950 a inséré
// un chunk "bootstrap" entre index.js et le reste), d'où la marge.
const MAX_CHUNK_DEPTH = 6;

/**
 * Collecte les chunks référencés par une source.
 *
 * On ne s'appuie sur aucune construction précise du bundler. Le build du jeu
 * est passé de Vite/rollup à rolldown (v950) : `__vite__mapDeps` a quitté
 * index.js, les strings sont devenues des template literals, et l'entrée ne
 * fait plus qu'un `import()` dynamique relatif vers un chunk "bootstrap".
 *
 * On récolte donc tout ce qui *ressemble* à un chemin de chunk, quelle que soit
 * la quote :
 *
 *   - `assets/xxx.js` -> relatif à la racine des assets du build
 *   - `./xxx.js`      -> relatif au chunk courant (import statique ou dynamique)
 *
 * Être large ne coûte rien : le BFS déduplique et s'arrête dès que les cibles
 * sont trouvées. C'est ce qui rend la traversée insensible au prochain
 * changement de bundler, comme les extracteurs le sont déjà à la syntaxe.
 */
export function collectChunkRefs(js, fromUrl, baseUrl) {
  const refs = new Map();

  const add = (spec, base) => {
    let url;
    try {
      url = new URL(spec, base).href;
    } catch {
      return;
    }
    if (!refs.has(url)) refs.set(url, { path: spec, url });
  };

  for (const [, spec] of js.matchAll(/["'`](assets\/[^"'`\s]+\.js)["'`]/g)) add(spec, baseUrl);
  for (const [, spec] of js.matchAll(/["'`](\.{1,2}\/[^"'`\s]+\.js)["'`]/g)) add(spec, fromUrl);

  return [...refs.values()];
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
async function findChunksInGraph(entryUrl, entryJs, baseUrl, targets) {
  const found = new Map();
  const remaining = new Set(targets.map((t) => t.id));
  const visited = new Set([entryUrl]);
  let frontier = collectChunkRefs(entryJs, entryUrl, baseUrl);

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

      for (const sub of collectChunkRefs(content, chunk.url, baseUrl)) {
        if (!visited.has(sub.url)) nextFrontier.push(sub);
      }
    }

    frontier = nextFrontier;
  }

  return found;
}

// Mémo des chunks résolus, pour l'index courant uniquement.
//
// Le TTL du cache bundle est court (5 min) alors que le graphe, lui, ne bouge
// qu'aux mises à jour du jeu : sans mémo, chaque expiration re-parcourt ~70
// chunks (~7 Mo) pour retrouver les 2 mêmes fichiers. Les chunks sont
// content-hashés et servis sous /version/<n>/, donc une URL déjà résolue reste
// valide tant que l'index ne change pas ; on la re-teste quand même, et tout
// écart retombe sur le parcours complet.
let memo = { indexUrl: null, urls: new Map() };

async function fetchMemoizedChunks(indexUrl, targets, found) {
  if (memo.indexUrl !== indexUrl || !targets.length) return targets;

  const remaining = [];

  for (const target of targets) {
    const url = memo.urls.get(target.id);
    if (!url) {
      remaining.push(target);
      continue;
    }

    let content;
    try {
      content = await fetchText(url);
    } catch {
      remaining.push(target);
      continue;
    }

    if (target.test(content)) {
      logger.debug({ id: target.id, url }, "Chunk resolved from memo");
      found.set(target.id, { url, content });
    } else {
      remaining.push(target);
    }
  }

  return remaining;
}

function memoizeChunks(indexUrl, found) {
  const urls = new Map();
  for (const [id, chunk] of found) {
    if (chunk.url !== indexUrl) urls.set(id, chunk.url);
  }
  memo = { indexUrl, urls };
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

  const targets = [
    { id: "data", test: (c) => c.includes(DATA_SIGNATURE) },
    ...COLOR_TARGETS.map((t) => ({
      id: t.id,
      test: (c) => definesColorsFor(c, t.names, COLOR_MIN_HITS),
    })),
  ];

  // 1. index.js lui-même (builds où l'entrée porte encore les données)
  const found = new Map();
  let remaining = [];
  for (const target of targets) {
    if (target.test(indexJs)) found.set(target.id, { url: indexUrl, content: indexJs });
    else remaining.push(target);
  }

  // 2. Chemin rapide : URLs déjà résolues pour ce même index.
  remaining = await fetchMemoizedChunks(indexUrl, remaining, found);

  // 3. Parcours du graphe pour ce qu'il reste.
  if (remaining.length) {
    const chunks = await findChunksInGraph(indexUrl, indexJs, baseUrl, remaining);
    for (const [id, chunk] of chunks) found.set(id, chunk);
  }

  memoizeChunks(indexUrl, found);

  const dataChunk = found.get("data");
  if (!dataChunk) {
    throw new Error("Game data chunk not found in bundle graph");
  }

  const uiColorsSources = [];
  const seen = new Set();
  for (const target of COLOR_TARGETS) {
    const chunk = found.get(target.id);
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
