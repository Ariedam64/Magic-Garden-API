import { getBaseUrl } from "../../assets/assets.js";
import { loadManifest, getBundleByName, assetSourcePaths } from "../../assets/manifest.js";
import { decodeKTX2, isKTX2 } from "../ktx2Decoder.js";
import sharp from "../sharp.js";
import { config } from "../../config/index.js";
import { joinUrl } from "../../utils/url.js";
import { LruCache } from "../../utils/lruCache.js";

const state = {
  ready: false,
  baseUrl: null,

  // ✅ liste brute dans l'ordre du manifest
  all: [],

  pending: null,
};

// Depuis la v1973, le bundle `cosmetic` ne garde que les bannières en PNG : les
// tenues d'avatar (Top, Mid, Bottom, Expression…) sont dans `compressed-art`,
// en KTX2 par format GPU, sous l'alias `compressed-art/cosmetic/<Type>_<Nom>`.
// Un navigateur ne sait pas afficher un KTX2 : l'API les sert décodés en PNG
// (`/assets/cosmetics/<Type>_<Nom>.png`, voir renderCosmeticPng).
const COMPRESSED_BUNDLE = "compressed-art";
const COMPRESSED_COSMETIC_ALIAS = "compressed-art/cosmetic/";

function splitBase(base) {
  const i = base.indexOf("_");
  return i < 0 ? null : { cat: base.slice(0, i), name: base.slice(i + 1) };
}

/**
 * URL publique du PNG d'un cosmétique KTX2. `v` est le hash de contenu du
 * fichier du jeu (`Top_Haunt.bc7.<hash>.ktx2`) : il change avec l'image.
 */
function compressedCosmeticUrl(base, src) {
  const hash = src.split("/").pop().split(".").slice(-2, -1)[0];
  const root = String(config.sprites.baseUrl || "").replace(/\/$/, "");
  const query = /^[0-9a-f]+$/i.test(hash ?? "") ? `?v=${hash}` : "";
  return `${root}/assets/cosmetics/${encodeURIComponent(base)}.png${query}`;
}

export async function initCosmetics({ baseUrl: forcedBaseUrl = null } = {}) {
  if (state.pending) return state.pending;

  state.pending = (async () => {
    const baseUrl = forcedBaseUrl || (await getBaseUrl());
    if (!baseUrl) throw new Error("BaseUrl not available");

    // ✅ si version identique -> pas besoin de rebuild
    if (state.ready && state.baseUrl === baseUrl) return true;

    const manifest = await loadManifest({ baseUrl });
    const bundle = getBundleByName(manifest, "cosmetic");
    if (!bundle) throw new Error("No 'cosmetic' bundle in manifest");

    const all = [];
    const seen = new Set();

    for (const asset of bundle.assets || []) {
      for (const src of assetSourcePaths(asset)) {
        if (!/^cosmetic\/.+\.png$/i.test(src)) continue;

        const file = src.split("/").pop();
        if (!file) continue;

        const base = file.replace(/\.png$/i, "");
        const parts = splitBase(base);
        if (!parts || seen.has(base)) continue;
        seen.add(base);

        all.push({ ...parts, base, src, url: joinUrl(baseUrl, src) });
      }
    }

    for (const asset of getBundleByName(manifest, COMPRESSED_BUNDLE)?.assets || []) {
      const alias = (asset.alias || []).find((a) => String(a).startsWith(COMPRESSED_COSMETIC_ALIAS));
      const src = assetSourcePaths(asset).find(isKTX2);
      if (!alias || !src) continue;

      const base = alias.slice(COMPRESSED_COSMETIC_ALIAS.length);
      const parts = splitBase(base);
      if (!parts || seen.has(base)) continue;
      seen.add(base);

      all.push({
        ...parts,
        base,
        src,
        url: compressedCosmeticUrl(base, src),
        sourceUrl: joinUrl(baseUrl, src),
      });
    }

    state.baseUrl = baseUrl;
    state.all = all;
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
export async function getCosmeticsPayload({ full = false, baseUrl = null } = {}) {
  await initCosmetics({ baseUrl });

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

// PNG décodés, par URL du KTX2 (versionnée par hash) : ~190 cosmétiques de
// 640x640, quelques dizaines de Ko chacun une fois en PNG.
const pngCache = new LruCache({ max: 400, maxBytes: 64 * 1024 * 1024, sizeOf: (png) => png.length });
const pendingPngs = new Map();

/**
 * PNG d'un cosmétique que le jeu ne sert plus qu'en KTX2.
 *
 * @param {string} base - `<Type>_<Nom>`, ex. `Top_Haunt`
 * @returns {Promise<Buffer|null>} null si ce cosmétique n'existe pas en KTX2
 */
export async function renderCosmeticPng(base, { baseUrl = null } = {}) {
  await initCosmetics({ baseUrl });
  const item = state.all.find((x) => x.base === base && x.sourceUrl);
  if (!item) return null;

  const hit = pngCache.get(item.sourceUrl);
  if (hit) return hit;
  if (pendingPngs.has(item.sourceUrl)) return pendingPngs.get(item.sourceUrl);

  const promise = (async () => {
    const res = await fetch(item.sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${item.sourceUrl}`);

    const { width, height, rgba } = await decodeKTX2(Buffer.from(await res.arrayBuffer()));
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    pngCache.set(item.sourceUrl, png);
    return png;
  })();

  pendingPngs.set(item.sourceUrl, promise);
  try {
    return await promise;
  } finally {
    pendingPngs.delete(item.sourceUrl);
  }
}
