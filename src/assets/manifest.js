import { getBaseUrl } from "./assets.js";

// Depuis la v1973, le jeu ne sert plus `manifest.json` mais un manifest par
// format de texture GPU (`manifest.{bc7,astc,etc2,bc3,rgba8}.json`), choisi
// selon la carte graphique. On prend BC7 : c'est la variante qui a une image
// pleine taille pour chaque atlas (rgba8 s'arrête à la demi-taille), et
// ktx2Decoder sait la lire. `manifest.json` reste essayé, sur un 404, pour
// les versions qui le servent encore.
const MANIFEST_FILENAMES = ["manifest.bc7.json", "manifest.json"];

// Depuis la v2151, ces noms ne sont plus servis sous `/version/<n>/assets/` :
// le jeu lit le chemin de son manifest, adressé par contenu
// (`/runtime-assets/manifest.bc7.<hash>.json`), dans une balise
// `<meta name="magiccircle-asset-manifest-<format>">` de sa page. Les chemins
// listés par le manifest restent résolus contre `/version/<n>/assets/`
// (basePath du jeu), donc `baseUrl` ne change pas pour les appelants.
const MANIFEST_META_NAME = "magiccircle-asset-manifest-bc7";

const cachedManifests = new Map();   // baseUrl -> manifest
const pendingManifests = new Map();  // baseUrl -> promise

// Une entrée par version du jeu : sans borne, un processus qui ne redémarre
// plus après chaque sync en accumulerait une par mise à jour (~6 par jour).
// La version courante et la précédente suffisent (une sync en cours peut
// encore lire l'ancienne).
const MAX_CACHED_MANIFESTS = 3;

function readMetaContent(html, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const [, key, , value] of tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attrs[key.toLowerCase()] = value;
    }
    if (attrs.name === name && attrs.content) return attrs.content;
  }
  return null;
}

/**
 * URL du manifest déclarée par la page du jeu (v2151+), ou null si la page
 * n'existe pas ou n'en déclare pas (versions antérieures).
 */
async function findDeclaredManifestUrl(baseUrl) {
  const pageUrl = new URL("../index.html", baseUrl).toString();
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${pageUrl}`);
  }

  const content = readMetaContent(await res.text(), MANIFEST_META_NAME);
  return content ? new URL(content, pageUrl).toString() : null;
}

async function fetchManifest(baseUrl) {
  const declaredUrl = await findDeclaredManifestUrl(baseUrl);
  const urls = declaredUrl
    ? [declaredUrl]
    : MANIFEST_FILENAMES.map((name) => new URL(name, baseUrl).toString());

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });

    if (res.status === 404 && i < urls.length - 1) continue;
    if (!res.ok) {
      throw new Error(`Fetch failed (${res.status}) for ${url}`);
    }

    return res.json();
  }
}

export async function loadManifest({ baseUrl } = {}) {
  const resolvedBaseUrl = baseUrl || (await getBaseUrl());
  if (!resolvedBaseUrl) return null;

  if (cachedManifests.has(resolvedBaseUrl)) return cachedManifests.get(resolvedBaseUrl);
  if (pendingManifests.has(resolvedBaseUrl)) return pendingManifests.get(resolvedBaseUrl);

  const promise = fetchManifest(resolvedBaseUrl);

  pendingManifests.set(resolvedBaseUrl, promise);

  try {
    const manifest = await promise;
    cachedManifests.set(resolvedBaseUrl, manifest);
    while (cachedManifests.size > MAX_CACHED_MANIFESTS) {
      cachedManifests.delete(cachedManifests.keys().next().value);
    }
    return manifest;
  } finally {
    pendingManifests.delete(resolvedBaseUrl);
  }
}

export function getBundleByName(manifest, bundleName = "default") {
  if (!manifest || !Array.isArray(manifest.bundles)) return null;
  return manifest.bundles.find((b) => b?.name === bundleName) || null;
}

/**
 * A manifest `src` entry is either a plain path string (legacy game versions)
 * or a multi-resolution descriptor `{ src, resolution }` (current versions,
 * e.g. sprites-1x-0.json @1 and sprites-2x-0.json @2).
 * Returns `{ src, resolution }` with a null resolution for legacy entries.
 */
function normalizeSourceEntry(entry) {
  if (typeof entry === "string") return { src: entry, resolution: null };
  if (entry && typeof entry.src === "string") {
    const resolution = typeof entry.resolution === "number" ? entry.resolution : null;
    return { src: entry.src, resolution };
  }
  return null;
}

function normalizeAssetSources(asset) {
  const sources = Array.isArray(asset?.src) ? asset.src : [];
  return sources.map(normalizeSourceEntry).filter(Boolean);
}

/**
 * Chemins déclarés par un asset, quelle que soit la forme du manifest.
 *
 * À lire plutôt que `asset.src` directement : le jeu y a mis des chaînes nues,
 * puis des descripteurs `{ src, resolution }`, puis `{ src, progressSize }`
 * (v1231). Chaque extracteur qui filtrait sur `typeof src === "string"` s'est
 * donc vidé en silence à la bascule.
 */
export function assetSourcePaths(asset) {
  return normalizeAssetSources(asset).map((entry) => entry.src);
}

/**
 * Among the variants of a single asset, keep only the highest resolution one.
 * Entries without a resolution (legacy) are all kept, since they are distinct
 * assets rather than variants of the same asset.
 */
function pickHighestResolution(entries) {
  const withResolution = entries.filter((e) => e.resolution !== null);
  if (!withResolution.length) return entries;

  const best = withResolution.reduce((a, b) => (b.resolution > a.resolution ? b : a));
  return [best];
}

/**
 * All source paths declared by a bundle, with multi-resolution descriptors
 * unwrapped to their path. Every variant is returned (no resolution filtering).
 */
export function extractAllSources(bundle) {
  if (!bundle || !Array.isArray(bundle.assets)) return [];

  const sources = new Set();

  for (const asset of bundle.assets) {
    for (const entry of normalizeAssetSources(asset)) {
      sources.add(entry.src);
    }
  }

  return Array.from(sources);
}

/**
 * JSON atlas paths declared by a bundle, in manifest order.
 * For multi-resolution assets, only the full-resolution variant is returned so
 * the same frames are not ingested twice.
 */
export function extractJsonFiles(bundle) {
  if (!bundle || !Array.isArray(bundle.assets)) return [];

  const jsonFiles = new Set();

  for (const asset of bundle.assets) {
    const jsonEntries = normalizeAssetSources(asset).filter(
      (entry) => entry.src.endsWith(".json") && !MANIFEST_FILENAMES.includes(entry.src)
    );

    for (const entry of pickHighestResolution(jsonEntries)) {
      jsonFiles.add(entry.src);
    }
  }

  return Array.from(jsonFiles);
}
