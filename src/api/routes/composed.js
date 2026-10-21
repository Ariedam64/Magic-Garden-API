// src/api/routes/composed.js
import express from "express";
import { asyncHandler, Errors } from "../middleware/index.js";
import { composeSprite, getComposeSourceTag } from "../../assets/sprites/spriteComposer.js";
import { buildWeakEtag, isFresh, applyCacheHeaders } from "../../utils/httpCache.js";

export const composedRouter = express.Router();

const COMPOSED_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=3600";

/**
 * GET /assets/sprites/composed
 *   ?key=sprite/tallplant/Cactus
 *   &mutations=Rainbow,Wet,Amberlit   (order-insensitive, deduplicated server-side)
 *
 * Returns a pre-composed PNG with mutations applied.
 * 404 only when the base key does not exist in the atlas.
 * Unknown mutation ids are silently ignored.
 */
composedRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const key = String(req.query.key || "").trim();
    if (!key) throw Errors.badRequest("Missing required query param: key");

    // Sanitize key: must look like sprite/<category>/<name>, weather/<name> or
    // tile/<name>. Upstream asset names occasionally contain spaces (e.g.
    // "Rectangle 81"), so the allow-list includes a literal space. Lookup is
    // dict-based (no filesystem), so path-traversal isn't a concern.
    if (!/^[\w/\-. ]+$/.test(key)) throw Errors.badRequest("Invalid key format");

    const rawMutations = String(req.query.mutations || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // L'ETag suit les sources de la composition (version des atlas, PNG sur
    // disque, sprites rendus depuis Rive) : sans elles, un client gardait sa
    // copie d'avant une mise à jour du jeu, revalidée en 304 indéfiniment.
    const sourceTag = await getComposeSourceTag();
    const etag = buildWeakEtag("composed", sourceTag, key, rawMutations.sort().join(","));
    if (isFresh(req, etag)) {
      applyCacheHeaders(res, { etag, cacheControl: COMPOSED_CACHE_CONTROL });
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      return res.status(304).end();
    }

    const pngBuffer = await composeSprite(key, rawMutations);
    if (!pngBuffer) throw Errors.notFound(`Sprite not found: ${key}`);

    applyCacheHeaders(res, { etag, cacheControl: COMPOSED_CACHE_CONTROL });
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.type("image/png").send(pngBuffer);
  })
);
