import { getBaseUrl } from "./assets.js";

const MANIFEST_FILENAME = "manifest.json";

const cachedManifests = new Map();   // baseUrl -> manifest
const pendingManifests = new Map();  // baseUrl -> promise

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Fetch failed (${res.status}) for ${url}`);
  }

  return res.json();
}

export async function loadManifest({ baseUrl } = {}) {
  const resolvedBaseUrl = baseUrl || (await getBaseUrl());
  if (!resolvedBaseUrl) return null;

  if (cachedManifests.has(resolvedBaseUrl)) return cachedManifests.get(resolvedBaseUrl);
  if (pendingManifests.has(resolvedBaseUrl)) return pendingManifests.get(resolvedBaseUrl);

  const manifestUrl = new URL(MANIFEST_FILENAME, resolvedBaseUrl).toString();
  const promise = fetchJson(manifestUrl);

  pendingManifests.set(resolvedBaseUrl, promise);

  try {
    const manifest = await promise;
    cachedManifests.set(resolvedBaseUrl, manifest);
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
      (entry) => entry.src.endsWith(".json") && entry.src !== MANIFEST_FILENAME
    );

    for (const entry of pickHighestResolution(jsonEntries)) {
      jsonFiles.add(entry.src);
    }
  }

  return Array.from(jsonFiles);
}
