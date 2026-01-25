import { getBaseUrl } from "../../assets/assets.js";
import { loadManifest, getBundleByName } from "../../assets/manifest.js";
import { joinUrl } from "../../utils/url.js";

const MANIFEST_FILENAME = "manifest.json";

const state = {
  ready: false,
  baseUrl: null,

  // ✅ liste brute dans l'ordre du manifest + multi-packs
  all: [],

  pending: null,
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

function normalizeName(key) {
  if (!key) return "";
  const x = String(key);
  return x.includes("/") ? x.split("/").pop() : x;
}

function getCategory(key, sourceJson = "") {
  if (!key) return "misc";
  const k = String(key);

  // ✅ cas spéciaux
  if (k.startsWith("weather/")) return "weather";
  if (sourceJson.includes("tiles")) return "tiles";

  // ✅ format principal: sprite/<group>/<name>
  if (!k.startsWith("sprite/")) return "misc";

  const group = k.split("/")[1] || "misc";

  switch (group) {
    case "ui":
      return "ui";
    case "seed":
      return "seeds";
    case "mutation":
    case "mutation-overlay":
      return "mutations";
    case "plant":
      return "plants";
    case "tallplant":
      return "tallPlants";
    case "pet":
      return "pets";
    case "decor":
      return "decor";
    case "object":
      return "objects";
    case "item":
      return "items";
    case "animation":
      return "animations";
    case "winter":
      return "winter";
    default:
      return group;
  }
}

function extractJsonFilesFromBundle(bundle) {
  const out = [];
  const seen = new Set();

  for (const asset of bundle.assets || []) {
    for (const src of asset.src || []) {
      if (typeof src !== "string") continue;
      if (!src.endsWith(".json")) continue;
      if (src === MANIFEST_FILENAME) continue;

      if (!seen.has(src)) {
        seen.add(src);
        out.push(src); // ✅ ordre conservé
      }
    }
  }

  return out;
}

function resolveMetaImageSrc(sourceJson, metaImage) {
  if (!sourceJson || !metaImage) return null;

  // meta.image est souvent juste "atlas.png" => on le remet dans le même dossier que le .json
  const parts = String(sourceJson).split("/");
  parts.pop(); // remove filename.json
  const dir = parts.length ? parts.join("/") + "/" : "";
  return dir + String(metaImage).replace(/^\/+/, "");
}

export async function initSprites() {
  if (state.pending) return state.pending;

  state.pending = (async () => {
    const baseUrl = await getBaseUrl();
    if (!baseUrl) throw new Error("BaseUrl not available");

    // ✅ si version identique -> pas besoin de rebuild
    if (state.ready && state.baseUrl === baseUrl) return true;

    const manifest = await loadManifest({ baseUrl });
    const bundle = getBundleByName(manifest, "default");
    if (!bundle) throw new Error("No 'default' bundle in manifest");

    state.baseUrl = baseUrl;
    state.all = [];
    state.ready = false;

    const jsonFiles = extractJsonFilesFromBundle(bundle);
    const loaded = new Set(); // évite les doubles loads (multi-pack inclus)

    async function loadAtlas(jsonSrc, { optional = false } = {}) {
      if (!jsonSrc || loaded.has(jsonSrc)) return;
      loaded.add(jsonSrc);

      const jsonUrl = joinUrl(baseUrl, jsonSrc);

      let atlas;
      try {
        atlas = await fetchJson(jsonUrl);
      } catch (e) {
        if (optional) return;
        throw e;
      }

      const frames = atlas?.frames || {};
      const anims = atlas?.animations || {};
      const meta = atlas?.meta || {};
      const imageSrc = resolveMetaImageSrc(jsonSrc, meta.image);
      const imageUrl = imageSrc ? joinUrl(baseUrl, imageSrc) : null;

      // ✅ frames
      for (const key of Object.keys(frames)) {
        const f = frames[key];

        state.all.push({
          type: "frame",
          cat: getCategory(key, jsonSrc),
          id: key,
          name: normalizeName(key),

          key,
          sourceJson: jsonSrc,
          atlasImageSrc: imageSrc,
          url: imageUrl,

          frame: f?.frame || null, // {x,y,w,h}
          rotated: !!f?.rotated,
          trimmed: !!f?.trimmed,
          anchor: f?.anchor || null,

          sourceSize: f?.sourceSize || null,
          spriteSourceSize: f?.spriteSourceSize || null,
        });
      }

      // ✅ animations
      for (const animName of Object.keys(anims)) {
        const list = anims[animName];
        if (!Array.isArray(list) || !list.length) continue;

        state.all.push({
          type: "animation",
          cat: "animations",
          id: animName,
          name: normalizeName(animName),

          key: animName,
          frames: list,

          sourceJson: jsonSrc,
          atlasImageSrc: imageSrc,
          url: imageUrl,
        });
      }

      // ✅ multi-packs (si présents)
      const related = meta?.related_multi_packs || [];
      if (Array.isArray(related)) {
        for (const rel of related) {
          if (typeof rel !== "string") continue;
          await loadAtlas(rel, { optional: true });
        }
      }
    }

    // ✅ ordre manifest conservé
    for (const jsonSrc of jsonFiles) {
      await loadAtlas(jsonSrc);
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
 * - full=1 => inclut toutes les infos (atlas, anchor, etc.)
 *
 * options:
 * - full: boolean
 * - search: string (filtre sur id/key)
 * - cat: string (filtre catégorie)
 * - flat: boolean (retourne une liste au lieu de groups)
 */
export async function getSpritesPayload({ full = false, search = "", cat = "", flat = false } = {}) {
  await initSprites();

  const q = String(search || "").toLowerCase().trim();
  const filterCat = String(cat || "").trim();

  const list = [];

  for (const x of state.all) {
    if (filterCat && x.cat !== filterCat) continue;
    if (q && !String(x.id || "").toLowerCase().includes(q)) continue;

    list.push(
      full
        ? x
        : x.type === "animation"
          ? {
              type: "animation",
              id: x.id,
              name: x.name,
              url: x.url,
              frames: x.frames,
            }
          : {
              type: "frame",
              id: x.id,
              name: x.name,
              url: x.url,
              frame: x.frame,
            },
    );
  }

  if (flat) {
    return {
      baseUrl: state.baseUrl,
      count: list.length,
      items: list,
    };
  }

  const groups = new Map(); // ✅ garde l'ordre d'apparition

  for (const x of list) {
    const c = full ? x.cat : (state.all.find((z) => z.id === x.id)?.cat || "misc");
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(x);
  }

  return {
    baseUrl: state.baseUrl,
    count: list.length,
    categories: Array.from(groups, ([cat, items]) => ({ cat, items })),
  };
}
