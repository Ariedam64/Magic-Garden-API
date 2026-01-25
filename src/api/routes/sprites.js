// src/api/routes/sprites.js

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { asyncHandler, Errors } from "../middleware/index.js";

export const spritesRouter = express.Router();

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

/**
 * GET /sprites
 * List available sprite categories.
 */
spritesRouter.get("/", (_req, res) => {
  res.json({
    categories: Array.from(ALLOWED_CATEGORIES).sort(),
    baseUrl: config.sprites.baseUrl,
    exportDir: config.sprites.exportDir,
    usage: {
      endpoint: "GET /sprites/:category/:name",
      example: `${config.sprites.baseUrl}/sprites/seeds/Carrot.png`,
    },
  });
});
