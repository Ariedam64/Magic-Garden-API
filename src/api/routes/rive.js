// src/api/routes/rive.js

import express from "express";
import { config } from "../../config/index.js";
import { asyncHandler, Errors } from "../middleware/index.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import { loadRiveInventory } from "../../core/game/riveStorage.js";

export const riveRouter = express.Router();

/**
 * Les fichiers Rive du jeu, publiés comme ressources de l'API.
 *
 * Le jeu rend en vectoriel tout ce qui bouge : les pets, mais aussi les décors
 * animés, la bulle de pensée, la pièce et le coffre-cadeau. Les images qu'on
 * pré-encode servent les clients qui ne savent qu'afficher un fichier ; ceux
 * qui peuvent faire tourner le runtime Rive ont tout intérêt à jouer la source
 * — `pets.riv` fait 3 Mo pour 28 espèces et ~660 timelines.
 *
 * On publie donc l'inventaire relevé à la sync : quels artboards, quelles
 * timelines, quelles state machines, et surtout **le type de chaque entrée** —
 * la moitié de celles d'un pet sont des triggers et non des booléens, ce qui ne
 * se devine pas et casse en silence.
 */

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=300";

function proxiedUrl(url) {
  const base = (config.sprites.baseUrl || "").replace(/\/$/, "");
  return `${base}/assets/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Vue résumée d'un fichier : tout sauf le détail des artboards.
 */
function summarise(file) {
  const { artboards, ...rest } = file;

  return {
    ...rest,
    url: file.url ? proxiedUrl(file.url) : null,
    origin: file.url ?? null,
    artboards: Array.isArray(artboards) ? artboards.map((a) => a.name) : [],
  };
}

function detail(file) {
  return {
    ...file,
    url: file.url ? proxiedUrl(file.url) : null,
    origin: file.url ?? null,
  };
}

/**
 * GET /assets/rive
 * Inventaire des fichiers Rive. `?full=1` détaille les artboards (timelines,
 * state machines, entrées et leur type). `?key=pets` n'en renvoie qu'un.
 */
riveRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { key, full } = req.query;
    const { generatedAt, files } = await loadRiveInventory();

    if (key !== undefined && !files[key]) {
      throw Errors.notFound(
        `Unknown Rive file '${key}'. Available: ${Object.keys(files).join(", ") || "none"}`
      );
    }

    const wanted = key !== undefined ? { [key]: files[key] } : files;
    const detailed = full === "1" || key !== undefined;

    const payload = {
      count: Object.keys(wanted).length,
      baseUrl: config.sprites.baseUrl,
      generatedAt,
      // Le fichier est servi par le jeu sans en-tête CORS : `url` passe par
      // notre proxy, seul moyen pour un navigateur d'aller le chercher.
      files: Object.fromEntries(
        Object.entries(wanted).map(([k, file]) => [k, detailed ? detail(file) : summarise(file)])
      ),
    };

    const etag = buildWeakEtag(
      "assets:rive",
      config.sprites.baseUrl,
      String(generatedAt),
      req.originalUrl
    );

    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: CACHE_CONTROL });
      res.status(304).end();
      return;
    }

    applyCacheHeaders(res, { etag, cacheControl: CACHE_CONTROL });
    res.json(payload);
  })
);
