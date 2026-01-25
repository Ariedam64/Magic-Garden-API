// src/api/assets/sprites/exportSpritesToDisk.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { getSpritesPayload } from "./sprites.js";

async function downloadBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function safeName(name) {
  // évite Windows qui pleure pour rien
  return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
}

function ensurePng(name) {
  const base = safeName(name).replace(/\.(png|webp|jpg|jpeg)$/i, "");
  return `${base}.png`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Exporte tous les sprites découpés dans:
 *   outDir/sprite/<cat>/<name>.png
 *
 * - restoreTrim=true => remet le sprite dans sa taille sourceSize (comme ingame)
 * - si rotated=true => crop avec w/h swap + rotation
 */
export async function exportSpritesToDisk({
  outDir = "./export",
  restoreTrim = true,
  onlyCats = null, // ex: ["seeds","plants"]
} = {}) {
  const payload = await getSpritesPayload({ full: true, flat: true });
  const items = payload?.items || [];

  const frames = items.filter((x) => x.type === "frame" && x.url && x.frame);

  const filtered =
    Array.isArray(onlyCats) && onlyCats.length
      ? frames.filter((x) => onlyCats.includes(x.cat))
      : frames;

  // group par atlas URL pour éviter de re-download 500 fois
  const byAtlas = new Map();
  for (const s of filtered) {
    if (!byAtlas.has(s.url)) byAtlas.set(s.url, []);
    byAtlas.get(s.url).push(s);
  }

  await ensureDir(outDir);

  const atlasCache = new Map(); // url -> Buffer
  let exported = 0;

  for (const [atlasUrl, list] of byAtlas) {
    let atlasBuf = atlasCache.get(atlasUrl);
    if (!atlasBuf) {
      atlasBuf = await downloadBuffer(atlasUrl);
      atlasCache.set(atlasUrl, atlasBuf);
    }

    for (const s of list) {
      const { frame, rotated, trimmed, spriteSourceSize, sourceSize } = s;

      // ✅ TexturePacker: si rotated=true, la zone stockée est "pivotée",
      // donc pour crop on SWAP w/h. (sinon tu découpes à côté)
      const cropW = rotated ? frame.h : frame.w;
      const cropH = rotated ? frame.w : frame.h;

      let piece = sharp(atlasBuf).extract({
        left: frame.x,
        top: frame.y,
        width: cropW,
        height: cropH,
      });

      // ✅ on remet dans le bon sens
      if (rotated) {
        // si un jour tout est à 90° dans le mauvais sens, remplace 270 par 90.
        piece = piece.rotate(270);
      }

      // ✅ remet le padding d'origine si trimmed
      let out;
      if (
        restoreTrim &&
        trimmed &&
        sourceSize?.w &&
        sourceSize?.h &&
        spriteSourceSize?.x != null &&
        spriteSourceSize?.y != null
      ) {
        const buf = await piece.png().toBuffer();

        out = sharp({
          create: {
            width: sourceSize.w,
            height: sourceSize.h,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        }).composite([
          { input: buf, left: spriteSourceSize.x, top: spriteSourceSize.y },
        ]);
      } else {
        out = piece;
      }

      const catDir = path.join(outDir, "sprite", safeName(s.cat || "misc"));
      await ensureDir(catDir);

      const filename = ensurePng(s.name || s.id || "sprite");
      const dest = path.join(catDir, filename);

      await out.png().toFile(dest);
      exported++;
    }
  }

  return {
    baseUrl: payload.baseUrl,
    exported,
    atlases: byAtlas.size,
    outDir: path.resolve(outDir),
  };
}

/**
 * ✅ CLI fiable (Windows friendly)
 * Usage:
 *   node src/api/assets/sprites/exportSpritesToDisk.js ./sprites_dump
 */
const __filename = fileURLToPath(import.meta.url);

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const dir = process.argv[2] || "./export";

  console.log("[EXPORT] start ->", dir);

  exportSpritesToDisk({ outDir: dir })
    .then((r) => console.log("[EXPORT] done", r))
    .catch((e) => {
      console.error("[EXPORT] error", e);
      process.exit(1);
    });
}
