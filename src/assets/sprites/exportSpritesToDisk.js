// src/api/assets/sprites/exportSpritesToDisk.js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../sharp.js";
import { getSpritesPayload } from "./sprites.js";
import { decodeKTX2, isKTX2 } from "../ktx2Decoder.js";

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

/**
 * Load atlas image buffer and return a sharp-compatible source.
 * For KTX2 files, decodes to raw RGBA first.
 * For other formats (webp/png), returns the buffer directly.
 *
 * @returns {{ sharpInput: Buffer|object, sharpOptions: object|undefined }}
 */
async function loadAtlasImage(url, rawBuffer) {
  if (isKTX2(url)) {
    const { width, height, rgba } = await decodeKTX2(rawBuffer);
    return {
      sharpInput: rgba,
      sharpOptions: { raw: { width, height, channels: 4 } },
    };
  }
  return { sharpInput: rawBuffer, sharpOptions: undefined };
}

function safeName(name) {
  // évite Windows qui pleure pour rien
  return String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
}

function ensurePng(name) {
  const base = safeName(name).replace(/\.(png|webp|jpg|jpeg)$/i, "");
  return `${base}.png`;
}

/**
 * Chemin disque d'une frame exportée : `outDir/sprite/<cat>/<name>.png`.
 *
 * Exporté pour la composition de sprites, qui relit ces PNG plutôt que de
 * redécoder un atlas de 64 Mo : la règle de nommage ne doit vivre qu'ici.
 */
export function spriteFilePath(outDir, sprite) {
  return path.join(
    outDir,
    "sprite",
    safeName(sprite.cat || "misc"),
    ensurePng(sprite.name || sprite.id || "sprite")
  );
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
 *
 * Options:
 * - outDir: répertoire de sortie
 * - restoreTrim: restaure le padding d'origine (default: true)
 * - onlyCats: filtre par catégorie ["seeds","plants"]
 * - onlyKeys: filtre par clé de frame (Set ou Array) pour export sélectif
 */
export async function exportSpritesToDisk({
  outDir = "./export",
  restoreTrim = true,
  onlyCats = null, // ex: ["seeds","plants"]
  onlyKeys = null, // ex: Set(["sprite/plant/Carrot", "sprite/seed/Tomato"])
} = {}) {
  // includeRive:false — les sprites pré-rendus depuis Rive (pets) n'ont pas
  // d'atlas à découper, ils sont produits par exportPetsFromRive.js.
  const payload = await getSpritesPayload({ full: true, flat: true, includeRive: false });
  const items = payload?.items || [];

  const frames = items.filter((x) => x.type === "frame" && x.url && x.frame);

  // Filtre par catégorie
  let filtered =
    Array.isArray(onlyCats) && onlyCats.length
      ? frames.filter((x) => onlyCats.includes(x.cat))
      : frames;

  // Filtre par clés de frames (pour export sélectif)
  if (onlyKeys) {
    const keySet = onlyKeys instanceof Set ? onlyKeys : new Set(onlyKeys);
    if (keySet.size > 0) {
      filtered = filtered.filter((x) => keySet.has(x.key) || keySet.has(x.id));
    }
  }

  // group par atlas URL pour éviter de re-download 500 fois
  const byAtlas = new Map();
  for (const s of filtered) {
    if (!byAtlas.has(s.url)) byAtlas.set(s.url, []);
    byAtlas.get(s.url).push(s);
  }

  await ensureDir(outDir);

  let exported = 0;

  // Un atlas à la fois, sans le garder une fois ses frames écrites : décodé,
  // il pèse jusqu'à 64 Mo de RGBA, et chaque URL n'apparaît qu'une fois dans
  // `byAtlas`. L'ancien cache local ne servait jamais, mais retenait tous les
  // atlas jusqu'à la fin de l'export (~300 Mo pour une maj du jeu).
  for (const [atlasUrl, list] of byAtlas) {
    const atlas = await loadAtlasImage(atlasUrl, await downloadBuffer(atlasUrl));

    for (const s of list) {
      const { frame, rotated, trimmed, spriteSourceSize, sourceSize } = s;

      // ✅ TexturePacker: si rotated=true, la zone stockée est "pivotée",
      // donc pour crop on SWAP w/h. (sinon tu découpes à côté)
      const cropW = rotated ? frame.h : frame.w;
      const cropH = rotated ? frame.w : frame.h;

      let piece = sharp(atlas.sharpInput, atlas.sharpOptions).extract({
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

      const dest = spriteFilePath(outDir, s);
      await ensureDir(path.dirname(dest));

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
