// src/api/routes/sprites.js

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { asyncHandler, Errors } from "../middleware/index.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import { buildSpriteUrl } from "../../utils/spriteUrlBuilder.js";
import { getStoredVersionCached } from "../../core/game/versionStorage.js";

export const spritesRouter = express.Router();

const SPRITES_LIST_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=300";

// Whitelist of allowed categories
const ALLOWED_CATEGORIES = new Set([
  "seeds",
  "plants",
  "tallPlants",
  "mutations",
  "pets",
  "decor",
  "items",
  "objects",
  "ui",
  "animations",
  "weather",
  "tiles",
  "winter",
]);

/**
 * Sanitize filename to prevent directory traversal and other attacks.
 */
function sanitizeFilename(name) {
  if (!name) {
    return null;
  }

  const filename = String(name)
    .trim()
    .replace(/\0/g, "")           // Remove null bytes
    .replace(/\.\./g, "")         // Remove ..
    .replace(/[\/\\]/g, "");       // Remove slashes

  // Must end with .png
  if (!filename.endsWith(".png")) {
    return null;
  }

  // Must not be empty after sanitization
  if (filename.length === 0 || filename === ".png") {
    return null;
  }

  return filename;
}

/**
 * Validate category against whitelist.
 */
function isValidCategory(category) {
  return ALLOWED_CATEGORIES.has(String(category).trim());
}

/**
 * GET /sprites/:category/:name
 * Serve sprite PNG file.
 */
spritesRouter.get(
  "/:category/:name",
  asyncHandler(async (req, res) => {
    const { category, name } = req.params;

    // Validate category
    if (!isValidCategory(category)) {
      logger.warn({ category }, "Invalid sprite category requested");
      throw Errors.badRequest(
        `Invalid category '${category}'. Allowed: ${Array.from(ALLOWED_CATEGORIES).join(", ")}`
      );
    }

    // Sanitize filename
    const sanitized = sanitizeFilename(name);
    if (!sanitized) {
      logger.warn({ name }, "Invalid sprite filename requested");
      throw Errors.badRequest("Invalid sprite filename");
    }

    // Construct safe path
    const spritePath = path.join(
      config.sprites.exportDir,
      "sprite",
      category,
      sanitized
    );

    // Prevent directory traversal by ensuring path is within exportDir
    const exportDirResolved = path.resolve(config.sprites.exportDir);
    const spritePathResolved = path.resolve(spritePath);

    if (!spritePathResolved.startsWith(exportDirResolved)) {
      logger.error(
        { spritePath: spritePathResolved, exportDir: exportDirResolved },
        "Path traversal attempt detected"
      );
      throw Errors.forbidden("Access denied");
    }

    // Check if file exists
    try {
      await fs.access(spritePathResolved);
    } catch {
      logger.debug({ spritePath: spritePathResolved }, "Sprite file not found");
      throw Errors.notFound(
        `Sprite not found: ${category}/${sanitized}`
      );
    }

    // Serve file (use resolved absolute path)
    res.type("image/png");
    res.set("Cache-Control", "public, max-age=86400"); // 24 hours
    res.sendFile(spritePathResolved, (err) => {
      if (err) {
        logger.error({ error: err.message, spritePath: spritePathResolved }, "Error serving sprite file");
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              code: "SPRITE_SERVE_ERROR",
              message: "Error serving sprite file",
            },
          });
        }
      }
    });
  })
);

// In-memory catalog of exported PNG files, rebuilt at most once per minute.
const catalogCache = {
  builtAt: 0,
  byCategory: new Map(),
};
const CATALOG_TTL_MS = 60_000;

async function getSpriteCatalog() {
  const now = Date.now();
  if (now - catalogCache.builtAt < CATALOG_TTL_MS && catalogCache.byCategory.size) {
    return catalogCache.byCategory;
  }

  const byCategory = new Map();
  const spriteRoot = path.join(config.sprites.exportDir, "sprite");

  await Promise.all(
    Array.from(ALLOWED_CATEGORIES).map(async (category) => {
      try {
        const files = await fs.readdir(path.join(spriteRoot, category));
        const names = files
          .filter((f) => f.endsWith(".png"))
          .map((f) => f.slice(0, -4))
          .sort();
        if (names.length) {
          byCategory.set(category, names);
        }
      } catch {
        // Category directory missing on disk: skip it.
      }
    })
  );

  catalogCache.byCategory = byCategory;
  catalogCache.builtAt = now;
  return byCategory;
}

/**
 * GET /assets/sprites
 * Full catalog of exported sprites with ready-to-use PNG URLs.
 * Optional filters: ?cat=<category> and ?search=<substring>.
 */
spritesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { cat, search } = req.query;

    if (cat !== undefined && !isValidCategory(cat)) {
      throw Errors.badRequest(
        `Invalid category '${cat}'. Allowed: ${Array.from(ALLOWED_CATEGORIES).sort().join(", ")}`
      );
    }

    const catalog = await getSpriteCatalog();
    const version = await getStoredVersionCached().catch(() => null);
    const categories = Array.from(ALLOWED_CATEGORIES).sort();
    const needle = search ? String(search).toLowerCase() : null;

    const sprites = {};
    let count = 0;
    for (const category of categories) {
      if (cat && category !== cat) continue;
      const names = catalog.get(category) || [];
      const matching = needle
        ? names.filter((n) => n.toLowerCase().includes(needle))
        : names;
      if (!matching.length) continue;
      sprites[category] = matching.map((name) => ({
        name,
        url: buildSpriteUrl(category, name, { version }),
      }));
      count += matching.length;
    }

    const payload = {
      count,
      baseUrl: config.sprites.baseUrl,
      categories,
      sprites,
    };

    const etag = buildWeakEtag(
      "assets:sprites",
      config.sprites.baseUrl,
      String(version),
      cat || "",
      needle || "",
      String(count),
      categories.map((c) => (catalog.get(c) || []).length).join(",")
    );

    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: SPRITES_LIST_CACHE_CONTROL });
      res.status(304).end();
      return;
    }

    applyCacheHeaders(res, { etag, cacheControl: SPRITES_LIST_CACHE_CONTROL });
    res.json(payload);
  })
);
