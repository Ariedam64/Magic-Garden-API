import { getBaseUrl } from "../../assets/assets.js";
import { loadManifest, getBundleByName } from "../../assets/manifest.js";
import { joinUrl } from "../../utils/url.js";
import { round2 } from "../../utils/roundNumbers.js";

const state = {
  ready: false,
  baseUrl: null,

  // themes
  ambience: new Map(), // name -> url
  music: new Map(), // name -> url
  themeOrder: [],

  // sfx audio + atlas
  sfxAudioUrl: null, // audio/sfx/sfx.mp3
  sfxAtlasUrl: null,  // audio/sfx/sfx.json
  sfxAtlas: null,     // json

  pending: null,
};

function rememberTheme(name) {
  if (!name) return;
  if (!state.themeOrder.includes(name)) state.themeOrder.push(name);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

/**
 * Atlas peut être sous plusieurs formes selon le build:
 * - { start: 1.23, end: 2.34 }
 * - { start: 1.23, duration: 1.11 }
 * - [start, end]
 */
function normalizeSegment(seg) {
  if (!seg) return null;

  // Array form: [start, end]
  if (Array.isArray(seg) && seg.length >= 2) {
    const start = Number(seg[0]);
    const end = Number(seg[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  }

  // Object form
  if (typeof seg === "object") {
    const start = Number(seg.start);
    let end = Number(seg.end);

    // sometimes end missing, but duration exists
    if (!Number.isFinite(end) && Number.isFinite(Number(seg.duration))) {
      end = start + Number(seg.duration);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  }

  return null;
}

export async function initAudio() {
  if (state.pending) return state.pending;

  state.pending = (async () => {
    const baseUrl = await getBaseUrl();
    if (!baseUrl) throw new Error("BaseUrl not available");

    // ✅ version identique -> skip
    if (state.ready && state.baseUrl === baseUrl) return true;

    const manifest = await loadManifest({ baseUrl });
    const bundle = getBundleByName(manifest, "audio");
    if (!bundle) throw new Error("No 'audio' bundle in manifest");

    state.baseUrl = baseUrl;

    state.ambience.clear();
    state.music.clear();
    state.themeOrder = [];

    state.sfxAudioUrl = null;
    state.sfxAtlasUrl = null;
    state.sfxAtlas = null;

    for (const asset of bundle.assets || []) {
      const aliases = Array.isArray(asset.alias) ? asset.alias : [];
      const srcs = Array.isArray(asset.src) ? asset.src : [];

      // ✅ ambience/music — match on alias (src paths are now hashed)
      const aliasMatch = aliases
        .map(a => /^audio\/(ambience|music)\/(.+?)(?:\.wav)?$/i.exec(a))
        .find(Boolean);
      if (aliasMatch) {
        const cat = aliasMatch[1].toLowerCase();
        const name = aliasMatch[2];
        const rawSrc = srcs.find(s => typeof s === "string" && s.endsWith(".mp3"));
        if (rawSrc) {
          const url = joinUrl(baseUrl, rawSrc);
          rememberTheme(name);
          if (cat === "ambience") state.ambience.set(name, url);
          else state.music.set(name, url);
        }
        continue;
      }

      for (const src of srcs) {
        if (typeof src !== "string") continue;

        // ✅ sfx audio + atlas
        // Path changed from `audio/sfx/sfx.mp3` to `/runtime-assets/sfx.<hash>.mp3`
        if (/^audio\/sfx\/sfx\.mp3$|^\/runtime-assets\/sfx\.[a-f0-9]+\.mp3$/i.test(src)) {
          state.sfxAudioUrl = joinUrl(baseUrl, src);
          continue;
        }

        if (/^audio\/sfx\/sfx\.json$/i.test(src)) {
          state.sfxAtlasUrl = joinUrl(baseUrl, src);
          continue;
        }
      }
    }

    // ✅ load atlas (pour les timings)
    if (state.sfxAtlasUrl) {
      state.sfxAtlas = await fetchJson(state.sfxAtlasUrl);
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

export async function getAudioPayload() {
  await initAudio();

  const themes = state.themeOrder.map((name) => ({
    name,
    ambience: state.ambience.get(name) || null,
    music: state.music.get(name) || null,
  }));

  const sfxItems = [];

  if (state.sfxAtlas && state.sfxAudioUrl) {
    for (const name of Object.keys(state.sfxAtlas)) {
      const seg = normalizeSegment(state.sfxAtlas[name]);
      if (!seg) continue;

      const duration = Math.max(0, seg.end - seg.start);

      sfxItems.push({
        name,
        start: round2(seg.start),
        end: round2(seg.end),
        duration: round2(duration),
      });
    }
  }

  return {
    baseUrl: state.baseUrl,
    themes,
    sfx: {
      url: state.sfxAudioUrl, // ✅ une seule fois
      items: sfxItems,
    },
  };
}
