import { getBaseUrl } from "../../assets/assets.js";
import { loadManifest, getBundleByName } from "../../assets/manifest.js";
import { joinUrl } from "../../utils/url.js";

const state = {
  ready: false,
  baseUrl: null,

  // ✅ liste brute dans l'ordre du manifest
  all: [],

  pending: null,
};

export async function initCosmetics() {
  if (state.pending) return state.pending;

  state.pending = (async () => {
    const baseUrl = await getBaseUrl();
    if (!baseUrl) throw new Error("BaseUrl not available");

    // ✅ si version identique -> pas besoin de rebuild
    if (state.ready && state.baseUrl === baseUrl) return true;

    const manifest = await loadManifest({ baseUrl });
    const bundle = getBundleByName(manifest, "cosmetic");
    if (!bundle) throw new Error("No 'cosmetic' bundle in manifest");

    state.baseUrl = baseUrl;
    state.all = [];

    for (const asset of bundle.assets || []) {
      for (const src of asset.src || []) {
        if (typeof src !== "string") continue;
        if (!/^cosmetic\/.+\.png$/i.test(src)) continue;

        const file = src.split("/").pop();
        if (!file) continue;

        const base = file.replace(/\.png$/i, "");
        const i = base.indexOf("_");
        if (i < 0) continue;

        const cat = base.slice(0, i);
        const name = base.slice(i + 1);
        const url = joinUrl(baseUrl, src);

        state.all.push({ cat, name, base, src, url });
      }
    }

    state.ready = true;
    return true;
  })();

  try {
    return await state.pending;
  } finally {
    state.pending = null;
  }
}

/**
 * ✅ Payload API "propre"
 * - grouped par catégorie
 * - ordre manifest conservé
 * - full=1 => inclut src/base/cat
 */
export async function getCosmeticsPayload({ full = false } = {}) {
  await initCosmetics();

  const groups = new Map(); // garde l'ordre d'apparition

  for (const x of state.all) {
    if (!groups.has(x.cat)) groups.set(x.cat, []);

    groups.get(x.cat).push(
      full
        ? x
        : {
            id: x.base,
            name: x.name,
            url: x.url,
          },
    );
  }

  return {
    baseUrl: state.baseUrl,
    count: state.all.length,
    categories: Array.from(groups, ([cat, items]) => ({ cat, items })),
  };
}
