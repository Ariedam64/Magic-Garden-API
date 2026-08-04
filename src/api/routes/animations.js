// src/api/routes/animations.js

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../../logger/index.js";
import { config } from "../../config/index.js";
import { asyncHandler, Errors } from "../middleware/index.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import {
  getAnimationEntries,
  getAnimationSources,
  animationDir,
  ANIMATION_CATEGORIES,
} from "../../assets/sprites/riveAnimations.js";

export const animationsRouter = express.Router();

/**
 * Service des boucles animées rendues depuis Rive.
 *
 * Ce sont des fichiers pré-générés, jamais rendus à la requête : un cycle
 * coûte plusieurs secondes de CPU (cf. doc-rive.md §5). En production Nginx
 * sert le dossier directement ; cette route est le repli (dev, accès direct au
 * port Node) et porte le catalogue.
 *
 * À ne pas confondre avec la catégorie de sprites `animations`
 * (`/assets/sprites/animations/*.png`), qui est un lot d'images fixes issues
 * des atlas du jeu.
 */

const CATALOG_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=300";
const FILE_CACHE_CONTROL = "public, max-age=86400";

const ALLOWED_CATEGORIES = new Set(ANIMATION_CATEGORIES);

const CONTENT_TYPES = {
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Valide un nom de fichier d'animation (`<Name>_<clip>.<ext>`).
 *
 * Renvoie null pour tout ce qui n'est pas exactement ça : pas de séparateur de
 * chemin, pas d'octet nul, extension connue. Le sidecar (`_rive-animations`)
 * est exclu de fait, son extension étant `.json`.
 */
function parseAnimationFile(name) {
  if (!name) return null;

  const raw = String(name).trim();
  if (raw.includes("/") || raw.includes("\\") || raw.includes("\0") || raw.includes("..")) {
    return null;
  }

  const match = /^([A-Za-z0-9-]+)_([a-z0-9]+)\.(webp|gif)$/.exec(raw);
  if (!match) return null;

  return { file: raw, name: match[1], clip: match[2], format: match[3] };
}

/**
 * GET /assets/animations
 * Catalogue des boucles disponibles, avec leurs URLs prêtes à l'emploi.
 * Filtres : ?cat=<category>, ?name=<pet>, ?clip=<clip>, ?search=<substring>.
 */
animationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { cat, name, clip, search } = req.query;

    if (cat !== undefined && !ALLOWED_CATEGORIES.has(String(cat))) {
      throw Errors.badRequest(
        `Invalid category '${cat}'. Allowed: ${Array.from(ALLOWED_CATEGORIES).join(", ")}`
      );
    }

    const sources = await getAnimationSources();
    const entries = await getAnimationEntries();
    const needle = search ? String(search).toLowerCase() : null;

    const filtered = entries.filter((entry) => {
      if (cat && entry.category !== cat) return false;
      if (name && entry.name.toLowerCase() !== String(name).toLowerCase()) return false;
      if (clip && entry.clip !== String(clip)) return false;
      if (needle && !entry.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    const byCategory = {};
    for (const entry of filtered) {
      (byCategory[entry.category] ??= []).push(entry);
    }

    const payload = {
      count: filtered.length,
      baseUrl: config.sprites.baseUrl,
      categories: Array.from(ALLOWED_CATEGORIES),
      formats: config.animations.formats,
      // Une source par catégorie : chacune vient de son propre .riv, et leurs
      // exports ne se terminent pas au même moment.
      sources,
      animations: byCategory,
    };

    const etag = buildWeakEtag(
      "assets:animations",
      config.sprites.baseUrl,
      JSON.stringify(sources),
      req.originalUrl,
      String(filtered.length)
    );

    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: CATALOG_CACHE_CONTROL });
      res.status(304).end();
      return;
    }

    applyCacheHeaders(res, { etag, cacheControl: CATALOG_CACHE_CONTROL });
    res.json(payload);
  })
);

/**
 * GET /assets/animations/:category/:file
 * Serve an animated WebP/GIF loop.
 */
animationsRouter.get(
  "/:category/:file",
  asyncHandler(async (req, res) => {
    const { category, file } = req.params;

    if (!ALLOWED_CATEGORIES.has(String(category).trim())) {
      throw Errors.badRequest(
        `Invalid category '${category}'. Allowed: ${Array.from(ALLOWED_CATEGORIES).join(", ")}`
      );
    }

    const parsed = parseAnimationFile(file);
    if (!parsed) {
      logger.warn({ file }, "Invalid animation filename requested");
      throw Errors.badRequest("Invalid animation filename, expected <Name>_<clip>.webp|gif");
    }

    const dir = path.resolve(animationDir(category));
    const filePath = path.resolve(path.join(dir, parsed.file));

    // Ceinture et bretelles : le nom est déjà validé au motif, mais on refuse
    // tout ce qui sortirait du dossier.
    if (!filePath.startsWith(`${dir}${path.sep}`)) {
      logger.error({ filePath, dir }, "Path traversal attempt detected");
      throw Errors.forbidden("Access denied");
    }

    try {
      await fs.access(filePath);
    } catch {
      throw Errors.notFound(`Animation not found: ${category}/${parsed.file}`);
    }

    res.type(CONTENT_TYPES[parsed.format]);
    res.set("Cache-Control", FILE_CACHE_CONTROL);
    res.sendFile(filePath, (err) => {
      if (err) {
        logger.error({ error: err.message, filePath }, "Error serving animation file");
        if (!res.headersSent) {
          res.status(500).json({
            error: { code: "ANIMATION_SERVE_ERROR", message: "Error serving animation file" },
          });
        }
      }
    });
  })
);
