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

export function extractJsonFiles(bundle) {
  if (!bundle || !Array.isArray(bundle.assets)) return [];

  const jsonFiles = new Set();

  for (const asset of bundle.assets) {
    const sources = Array.isArray(asset?.src) ? asset.src : [];
    for (const src of sources) {
      if (
        typeof src === "string" &&
        src.endsWith(".json") &&
        src !== MANIFEST_FILENAME
      ) {
        jsonFiles.add(src);
      }
    }
  }

  return Array.from(jsonFiles);
}
