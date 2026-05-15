// src/assets/sprites/spriteComposer.js
import sharp from "sharp";
import { initSprites, lookupSprite, lookupSpriteByAliases } from "./sprites.js";
import { decodeKTX2, isKTX2 } from "../ktx2Decoder.js";
import { gameDataService } from "../../services/gameData.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MUTATION_ORDER = [
  "Gold", "Rainbow", "Wet", "Chilled", "Frozen", "Thunderstruck",
  "Ambershine", "Dawnlit", "Dawncharged", "Ambercharged",
];

const MUTATION_COLORS = {
  Gold:         { r: 235, g: 200, b:   0, a: 0.70 },
  Wet:          { r:  50, g: 180, b: 200, a: 0.25 },
  Chilled:      { r: 100, g: 160, b: 210, a: 0.45 },
  Frozen:       { r: 100, g: 130, b: 220, a: 0.50 },
  Thunderstruck:{ r:  16, g: 141, b: 163, a: 0.40 },
  Dawnlit:      { r: 209, g:  70, b: 231, a: 0.50 },
  Ambershine:   { r: 190, g: 100, b:  40, a: 0.50 },
  Dawncharged:  { r: 140, g:  80, b: 200, a: 0.50 },
  Ambercharged: { r: 170, g:  60, b:  25, a: 0.50 },
};

// Mutation sprite config — matches game bundle's `cd` object exactly.
// iconKey: sprite/mutation/<X> placed at target position
// tallIconKey: overrides iconKey for tall plants (z=-1, behind plant)
// overlayKey: sprite/mutation-overlay/<X> masked to plant silhouette (tall only)
// overlayFromBottom: overlay anchors at plant bottom instead of top
const MUTATION_CONFIG = {
  Wet:          { iconKey: "sprite/mutation/Wet",          tallIconKey: "sprite/mutation/Puddle",              overlayKey: "sprite/mutation-overlay/WetTallPlant" },
  Chilled:      { iconKey: "sprite/mutation/Chilled",                                                          overlayKey: "sprite/mutation-overlay/ChilledTallPlant" },
  Frozen:       { iconKey: "sprite/mutation/Frozen",                                                           overlayKey: "sprite/mutation-overlay/FrozenTallPlant" },
  Thunderstruck:{ iconKey: "sprite/mutation/Thunderstruck", tallIconKey: "sprite/mutation/ThunderstruckGround", overlayKey: "sprite/mutation-overlay/ThunderstruckTallPlant", overlayFromBottom: true },
  Dawnlit:      { iconKey: "sprite/mutation/Dawnlit" },
  Ambershine:   { iconKey: "sprite/mutation/Amberlit" },
  Dawncharged:  { iconKey: "sprite/mutation/Dawncharged" },
  Ambercharged: { iconKey: "sprite/mutation/Ambercharged" },
};

// Floating mutations drawn in front of plant (z=10) — matches game's Qd set
const FLOATING_MUTATIONS = new Set(["Dawnlit", "Ambershine", "Dawncharged", "Ambercharged"]);
const WARM_MUTATIONS      = new Set(["Ambershine", "Dawnlit", "Dawncharged", "Ambercharged"]);
const WATER_ICE_MUTATIONS = new Set(["Wet", "Chilled", "Frozen", "Thunderstruck"]);

// Exact values from game bundle ($d and ef)
const MUT_ICON_Y_EXCEPT = {
  Banana: 0.68, Beet: 0.65, Carrot: 0.60, Sunflower: 0.50,
  Starweaver: 0.50, Clover: 0.30, FourLeafClover: 0.30,
  FavaBean: 0.25, BurrosTail: 0.20, Rose: 0.16,
};
const MUT_ICON_X_EXCEPT = { Pepper: 0.60, Banana: 0.60 };

const TILE_SIZE_WORLD       = 256;
const BASE_ICON_SCALE       = 0.5; // du=1/2 in game bundle
const TALL_ICON_SCALE_BOOST = 2;   // tf=2 in game bundle

// Rainbow gradient stops
const RAINBOW_STOPS = (() => {
  const hex = (s) => ({ r: parseInt(s.slice(1,3),16), g: parseInt(s.slice(3,5),16), b: parseInt(s.slice(5,7),16) });
  return [
    { pos: 0.0, ...hex("#FF1744") },
    { pos: 0.2, ...hex("#FF9100") },
    { pos: 0.4, ...hex("#FFEA00") },
    { pos: 0.6, ...hex("#00E676") },
    { pos: 0.8, ...hex("#2979FF") },
    { pos: 1.0, ...hex("#D500F9") },
  ];
})();

// ─── Plant meta cache ─────────────────────────────────────────────────────────

// Lazy-loaded from plant data. Keyed by the sprite filename (last path segment, no ext).
// Built from species where plant.tileTransformOrigin === "bottom" (game's tall-plant marker).
// harvestTypeMap: species → "Single" | "Multiple" (from plant.harvestType)
let plantMetaCache = null;

async function getPlantMeta() {
  if (plantMetaCache) return plantMetaCache;
  const meta = { tallSpriteNames: new Set(), harvestTypeMap: new Map() };
  try {
    const plants = await gameDataService.getPlants();
    for (const [species, data] of Object.entries(plants)) {
      if (data.plant?.tileTransformOrigin === "bottom" && data.plant?.sprite) {
        const name = data.plant.sprite.split("/").pop().replace(/\?.*$/, "").replace(/\.png$/i, "");
        if (name) meta.tallSpriteNames.add(name);
      }
      if (data.plant?.harvestType) {
        meta.harvestTypeMap.set(species, data.plant.harvestType);
      }
    }
  } catch {
    // leave sets/maps empty on error
  }
  plantMetaCache = meta;
  return meta;
}

// ─── Caches ───────────────────────────────────────────────────────────────────

// url → { sharpInput, sharpOptions }
const atlasCache = new Map();

// cacheKey → PNG Buffer
const composedCache = new Map();
const COMPOSED_CACHE_MAX = 500;

// ─── Atlas helpers ────────────────────────────────────────────────────────────

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function getAtlasBuffer(url) {
  if (atlasCache.has(url)) return atlasCache.get(url);
  const raw = await downloadBuffer(url);
  let entry;
  if (isKTX2(url)) {
    const decoded = await decodeKTX2(raw);
    entry = { sharpInput: decoded.rgba, sharpOptions: { raw: { width: decoded.width, height: decoded.height, channels: 4 } } };
  } else {
    entry = { sharpInput: raw, sharpOptions: undefined };
  }
  atlasCache.set(url, entry);
  return entry;
}

// ─── Sprite extraction ────────────────────────────────────────────────────────

/**
 * Extract a sprite from its atlas and restore trim padding.
 * Returns { buffer, width, height, anchor, isTall } or null.
 */
async function extractSprite(meta) {
  if (!meta || !meta.url || !meta.frame) return null;

  const { frame, rotated, trimmed, spriteSourceSize, sourceSize, anchor, url } = meta;

  let atlasEntry;
  try {
    atlasEntry = await getAtlasBuffer(url);
  } catch {
    return null;
  }

  const cropW = rotated ? frame.h : frame.w;
  const cropH = rotated ? frame.w : frame.h;

  let piece = sharp(atlasEntry.sharpInput, atlasEntry.sharpOptions).extract({
    left: frame.x, top: frame.y, width: cropW, height: cropH,
  });
  if (rotated) piece = piece.rotate(270);

  let buffer;
  if (trimmed && sourceSize?.w && sourceSize?.h && spriteSourceSize?.x != null) {
    const trimBuf = await piece.png().toBuffer();
    buffer = await sharp({
      create: { width: sourceSize.w, height: sourceSize.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: trimBuf, left: spriteSourceSize.x, top: spriteSourceSize.y }]).png().toBuffer();
  } else {
    buffer = await piece.png().toBuffer();
  }

  const w = sourceSize?.w ?? (rotated ? frame.h : frame.w);
  const h = sourceSize?.h ?? (rotated ? frame.w : frame.h);
  const { tallSpriteNames } = await getPlantMeta();

  return {
    buffer,
    width: w,
    height: h,
    anchor: anchor ?? { x: 0.5, y: 0.5 },
    isTall: meta.key?.startsWith("sprite/tallplant/") || tallSpriteNames.has(meta.key?.split("/").pop()),
    key: meta.key,
  };
}

async function extractByKey(key) {
  const meta = lookupSprite(key);
  return meta ? extractSprite(meta) : null;
}

// ─── Mutation normalization ───────────────────────────────────────────────────

function sortMutations(ids) {
  const unique = [...new Set(ids)];
  unique.sort((a, b) => {
    const ia = MUTATION_ORDER.indexOf(a);
    const ib = MUTATION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return unique;
}

function buildColorList(sorted) {
  if (sorted.includes("Gold")) return ["Gold"];
  if (sorted.includes("Rainbow")) return ["Rainbow"];
  const hasWarm = sorted.some((m) => WARM_MUTATIONS.has(m));
  if (hasWarm) return sorted.filter((m) => !WATER_ICE_MUTATIONS.has(m));
  return sorted;
}

function buildOverlayList(sorted) {
  return sorted.filter((m) => MUTATION_CONFIG[m]?.overlayKey);
}

function buildIconList(sorted) {
  return sorted.filter((m) => m !== "Gold" && m !== "Rainbow" && MUTATION_CONFIG[m]?.iconKey);
}

// ─── Gradient + HSL helpers ───────────────────────────────────────────────────

function lerpColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i], s1 = stops[i + 1];
    if (t >= s0.pos && t <= s1.pos) {
      const u = (t - s0.pos) / (s1.pos - s0.pos);
      return {
        r: s0.r + (s1.r - s0.r) * u,
        g: s0.g + (s1.g - s0.g) * u,
        b: s0.b + (s1.b - s0.b) * u,
      };
    }
  }
  return stops[stops.length - 1];
}

// CSS "color" blend mode — matches the game's od filter shader exactly.
// All values in [0, 1].
function getLum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function clipColor(r, g, b) {
  const l = getLum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) {
    const f = l / (l - n);
    r = l + (r - l) * f;
    g = l + (g - l) * f;
    b = l + (b - l) * f;
  }
  if (x > 1) {
    const f = (1 - l) / (x - l);
    r = l + (r - l) * f;
    g = l + (g - l) * f;
    b = l + (b - l) * f;
  }
  return { r, g, b };
}

function setLum(r, g, b, lum) {
  const d = lum - getLum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

// blendColor(base, blend, opacity) from the game shader:
//   setLuminosity(blend, getLuminosity(base)) * opacity + base * (1 - opacity)
function blendColorHSL(bR, bG, bB, fR, fG, fB, opacity) {
  const { r, g, b } = setLum(fR, fG, fB, getLum(bR, bG, bB));
  return {
    r: r * opacity + bR * (1 - opacity),
    g: g * opacity + bG * (1 - opacity),
    b: b * opacity + bB * (1 - opacity),
  };
}

// ─── Layer builders ───────────────────────────────────────────────────────────

// baseRaw: raw RGBA buffer (already decoded via sharp .raw())
async function buildSolidTintLayer(baseRaw, w, h, mutation) {
  const col = MUTATION_COLORS[mutation];
  if (!col) return null;

  const out = Buffer.allocUnsafe(w * h * 4);

  for (let i = 0; i < w * h; i++) {
    const baseAlpha = baseRaw[i * 4 + 3] / 255;
    out[i * 4]     = col.r;
    out[i * 4 + 1] = col.g;
    out[i * 4 + 2] = col.b;
    out[i * 4 + 3] = Math.round(col.a * baseAlpha * 255);
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function buildRainbowLayer(baseRaw, w, h, isTall) {
  // ColorGradientFilter stores (inputAngle - 90) then does radians() in the shader.
  // UV coords use Y-UP (OpenGL convention): y=0 at bottom, y=1 at top.
  // Projection: t = clamp(cpx * cos(rad) - cpy * sin(rad) + 0.5, 0, 1)
  // where cpx = px/w - 0.5 (centered), cpy = (1 - py/h) - 0.5 (Y-flipped, centered)
  const inputAngle  = isTall ? 0 : 130;
  const storedDeg   = inputAngle - 90;            // matches Zu setter: e - Yu (Yu=90)
  const rad         = storedDeg * (Math.PI / 180);
  const cosA        = Math.cos(rad);
  const sinA        = Math.sin(rad);

  const out = Buffer.allocUnsafe(w * h * 4);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i     = (py * w + px) * 4;
      const baseA = baseRaw[i + 3] / 255;

      if (baseA === 0) {
        out[i] = out[i+1] = out[i+2] = out[i+3] = 0;
        continue;
      }

      // Y-UP UV (OpenGL): y=0 at bottom → invert py
      const cpx = px / w - 0.5;
      const cpy = (1 - py / h) - 0.5;

      // projectLinearPosition equivalent (shader: result.x after rotate2d)
      const t = Math.min(1, Math.max(0, cpx * cosA - cpy * sinA + 0.5));

      // Gradient color
      const grad = lerpColor(RAINBOW_STOPS, t);
      const fR   = grad.r / 255;
      const fG   = grad.g / 255;
      const fB   = grad.b / 255;

      // Original sprite color (straight alpha)
      const bR = baseRaw[i]     / 255;
      const bG = baseRaw[i + 1] / 255;
      const bB = baseRaw[i + 2] / 255;

      // HSL "color" blend — game shader: blendColor(back.rgb, front.rgb, front.a)
      const { r, g, b } = blendColorHSL(bR, bG, bB, fR, fG, fB, baseA);

      out[i]     = Math.max(0, Math.min(255, Math.round(r * 255)));
      out[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
      out[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
      out[i + 3] = baseRaw[i + 3];
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function buildOverlayLayer(baseBuf, baseW, baseH, baseAnchor, overlayKey, overlayFromBottom) {
  const meta = lookupSprite(overlayKey);
  if (!meta) return null;
  const overlaySprite = await extractSprite(meta);
  if (!overlaySprite) return null;

  const { buffer: overlayBuf, width: ow, height: oh } = overlaySprite;

  // Game forces plant anchor.x for overlay X, anchor.y = 0 (top) or 1 (bottom)
  const basePosX    = baseW * baseAnchor.x;
  const rawOverlayX = Math.round(basePosX - baseAnchor.x * ow);
  const rawOverlayY = overlayFromBottom ? baseH - oh : 0;

  const cropLeft = rawOverlayX < 0 ? -rawOverlayX : 0;
  const cropTop  = rawOverlayY < 0 ? -rawOverlayY : 0;
  const canvasX  = Math.max(0, rawOverlayX);
  const canvasY  = Math.max(0, rawOverlayY);

  const visibleW = Math.min(ow - cropLeft, baseW - canvasX);
  const visibleH = Math.min(oh - cropTop,  baseH - canvasY);
  if (visibleW <= 0 || visibleH <= 0) return null;

  const clippedOverlay = (cropLeft > 0 || cropTop > 0 || visibleW < ow || visibleH < oh)
    ? await sharp(overlayBuf).extract({ left: cropLeft, top: cropTop, width: visibleW, height: visibleH }).png().toBuffer()
    : overlayBuf;

  // Place overlay on a transparent canvas, then mask to base silhouette
  const onBase = await sharp({
    create: { width: baseW, height: baseH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: clippedOverlay, left: canvasX, top: canvasY }]).png().toBuffer();

  return sharp(onBase)
    .composite([{ input: baseBuf, blend: "dest-in" }])
    .png().toBuffer();
}

// ─── Icon lookup ──────────────────────────────────────────────────────────────

async function resolveIcon(mutation, isTall) {
  const cfg = MUTATION_CONFIG[mutation];
  if (!cfg) return null;
  const key = (isTall && cfg.tallIconKey) ? cfg.tallIconKey : cfg.iconKey;
  return extractByKey(key);
}

// ─── Icon position ────────────────────────────────────────────────────────────

// Bundle logic: targetY = anchorY when harvestType === "Single" AND isVertical, else 0.4.
// harvestType defaults to "Single" for non-plant sprites (pets, items, etc.)
function computeIconComposite(iconSprite, baseW, baseH, baseAnchor, species, isTall, harvestType = "Single") {
  const { buffer: iconBuf, width: iconW, height: iconH, anchor: iconAnchor } = iconSprite;
  const anchorX = baseAnchor.x;
  const anchorY = baseAnchor.y;

  let targetX = anchorX;
  if (MUT_ICON_X_EXCEPT[species] !== undefined) targetX = MUT_ICON_X_EXCEPT[species];

  const isVertical = baseH > baseW * 1.5;
  let targetY = (harvestType === "Single" && isVertical) ? anchorY : 0.4;
  if (MUT_ICON_Y_EXCEPT[species] !== undefined) targetY = MUT_ICON_Y_EXCEPT[species];

  const basePosX  = baseW * anchorX;
  const basePosY  = baseH * anchorY;
  const offsetX   = (targetX - anchorX) * baseW;
  const offsetY   = (targetY - anchorY) * baseH;

  const minDim    = Math.min(baseW, baseH);
  const scale     = Math.min(1.5, minDim / TILE_SIZE_WORLD);
  const iconScale = BASE_ICON_SCALE * scale * (isTall ? TALL_ICON_SCALE_BOOST : 1);

  const drawW = Math.max(1, Math.round(iconW * iconScale));
  const drawH = Math.max(1, Math.round(iconH * iconScale));
  const drawX = Math.round(basePosX + offsetX - drawW * (iconAnchor?.x ?? 0.5));
  const drawY = Math.round(basePosY + offsetY - drawH * (iconAnchor?.y ?? 0.5));

  return { iconBuf, drawW, drawH, drawX, drawY };
}

// ─── Main composition ─────────────────────────────────────────────────────────

export function clearComposedCache() {
  composedCache.clear();
  atlasCache.clear();
  plantMetaCache = null;
}

/**
 * Compose a base sprite with mutations and return a PNG Buffer.
 * Returns null if the base sprite key does not exist.
 */
export async function composeSprite(baseKey, mutationIds = []) {
  await initSprites();

  const sorted     = sortMutations(mutationIds.map(String));
  const cacheKey   = `${baseKey}|${sorted.join(",")}`;

  if (composedCache.has(cacheKey)) return composedCache.get(cacheKey);

  // ── Base sprite ──────────────────────────────────────────────────────────
  const baseSpriteInfo = await extractByKey(baseKey);
  if (!baseSpriteInfo) return null;

  const { buffer: baseBuf, width: baseW, height: baseH, anchor: baseAnchor, isTall } = baseSpriteInfo;
  const species = baseKey.split("/").pop() ?? "";

  // ── Plant meta ───────────────────────────────────────────────────────────
  const { harvestTypeMap } = await getPlantMeta();
  const harvestType = harvestTypeMap.get(species) ?? "Single";

  // ── Decode base raw once (reused by all color layer builders) ────────────
  const baseRaw = await sharp(baseBuf).ensureAlpha().raw().toBuffer();

  // ── Mutation lists ───────────────────────────────────────────────────────
  const colorList   = buildColorList(sorted);
  const overlayList = isTall ? buildOverlayList(sorted) : [];
  const iconList    = buildIconList(sorted);

  // ── Resolve icons in parallel ────────────────────────────────────────────
  const resolvedIcons = await Promise.all(
    iconList.map(async (mutation) => {
      const iconSprite = await resolveIcon(mutation, isTall);
      if (!iconSprite) return null;

      const comp = computeIconComposite(iconSprite, baseW, baseH, baseAnchor, species, isTall, harvestType);

      let zIndex = 2;
      if (FLOATING_MUTATIONS.has(mutation)) zIndex = 10;
      else if (isTall) zIndex = -1;

      return { zIndex, ...comp };
    }),
  );
  const icons = resolvedIcons.filter(Boolean);

  // ── Compute bounding box to avoid clipping ───────────────────────────────
  let bbMinX = 0, bbMinY = 0, bbMaxX = baseW, bbMaxY = baseH;
  for (const icon of icons) {
    bbMinX = Math.min(bbMinX, icon.drawX);
    bbMinY = Math.min(bbMinY, icon.drawY);
    bbMaxX = Math.max(bbMaxX, icon.drawX + icon.drawW);
    bbMaxY = Math.max(bbMaxY, icon.drawY + icon.drawH);
  }
  const offX    = Math.ceil(-bbMinX);
  const offY    = Math.ceil(-bbMinY);
  const canvasW = Math.ceil(bbMaxX) + offX;
  const canvasH = Math.ceil(bbMaxY) + offY;
  const baseLeft = offX;
  const baseTop  = offY;

  // Helper: composite a batch of ops onto the current canvas
  async function composite(canvas, ops) {
    return sharp(canvas).composite(ops).png().toBuffer();
  }

  // Helper: resize an icon buffer
  async function resizeIcon(buf, w, h) {
    return sharp(buf).resize(Math.max(1, w), Math.max(1, h), { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  }

  // Helper: build composite ops for a group of icons (parallel resize)
  async function iconOps(group, xOff, yOff) {
    return Promise.all(
      group.map(async (icon) => ({
        input: await resizeIcon(icon.iconBuf, icon.drawW, icon.drawH),
        left: Math.max(0, Math.round(xOff + icon.drawX)),
        top:  Math.max(0, Math.round(yOff + icon.drawY)),
      })),
    );
  }

  // 1. Start with transparent canvas (expanded to fit all layers)
  let canvas = await sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();

  // 2. z = -1: icons behind base (tall plants) — batch composite
  const behindIcons = icons.filter((i) => i.zIndex === -1);
  if (behindIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(behindIcons, offX, offY));
  }

  // 3. Base sprite
  canvas = await composite(canvas, [{ input: baseBuf, left: baseLeft, top: baseTop }]);

  // 4. Color layers (built in parallel, composited sequentially — each blends onto prior result)
  const colorLayers = await Promise.all(
    colorList.map((mutation) =>
      mutation === "Rainbow"
        ? buildRainbowLayer(baseRaw, baseW, baseH, isTall)
        : buildSolidTintLayer(baseRaw, baseW, baseH, mutation),
    ),
  );
  for (const layer of colorLayers) {
    if (layer) canvas = await composite(canvas, [{ input: layer, left: baseLeft, top: baseTop }]);
  }

  // 5. z = 2: standard icons (above color layers) — batch composite
  const standardIcons = icons.filter((i) => i.zIndex === 2);
  if (standardIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(standardIcons, offX, offY));
  }

  // 6. Tall-plant overlays (masked to plant silhouette, sequential — each may interact)
  for (const mutation of overlayList) {
    const cfg = MUTATION_CONFIG[mutation];
    const overlayLayer = await buildOverlayLayer(baseBuf, baseW, baseH, baseAnchor, cfg.overlayKey, cfg.overlayFromBottom ?? false);
    if (overlayLayer) canvas = await composite(canvas, [{ input: overlayLayer, left: baseLeft, top: baseTop }]);
  }

  // 7. z = 10: floating icons (Dawnlit, Ambershine, …) — batch composite
  const floatingIcons = icons.filter((i) => i.zIndex === 10);
  if (floatingIcons.length > 0) {
    canvas = await composite(canvas, await iconOps(floatingIcons, offX, offY));
  }

  // ── Cache and return ─────────────────────────────────────────────────────
  if (composedCache.size >= COMPOSED_CACHE_MAX) {
    composedCache.delete(composedCache.keys().next().value);
  }
  composedCache.set(cacheKey, canvas);

  return canvas;
}
