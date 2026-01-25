import { fetchGameVersion } from "../core/game/version.js";

const ORIGIN = "https://magicgarden.gg";

let cachedBaseUrl = null;
let cachedVersion = null;
let pendingPromise = null;

export async function getBaseUrl({ origin = ORIGIN } = {}) {
  // anti-double-call
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    try {
      const version = await fetchGameVersion({ origin });

      if (!version) return null;

      // ✅ si la version n'a pas changé, on garde le cache
      if (cachedBaseUrl && cachedVersion === version) {
        return cachedBaseUrl;
      }

      const url = `${origin.replace(/\/+$/, "")}/version/${version}/assets/`;
      cachedBaseUrl = url;
      cachedVersion = version;
      return url;
    } catch {
      return null;
    } finally {
      pendingPromise = null;
    }
  })();

  return pendingPromise;
}

export async function getAssetUrl(relativePath, { origin = ORIGIN } = {}) {
  const baseUrl = await getBaseUrl({ origin });
  if (!baseUrl) return null;

  const cleanPath = relativePath ? String(relativePath).replace(/^\/+/, "") : "";
  return new URL(cleanPath, baseUrl).toString();
}

export async function initializeBaseUrl({ origin = ORIGIN } = {}) {
  await getBaseUrl({ origin });
}

export function isReady() {
  return Boolean(cachedBaseUrl);
}
