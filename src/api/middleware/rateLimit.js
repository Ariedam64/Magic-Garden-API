// src/api/middleware/rateLimit.js

import rateLimit from "express-rate-limit";
import { config } from "../../config/index.js";

/**
 * Middleware de rate limiting.
 * Limite le nombre de requêtes par IP sur une fenêtre de temps.
 */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests, please try again later",
    },
  },
  skip: () => !config.rateLimit.enabled, // Désactive si config.rateLimit.enabled = false
});

/**
 * Rate limiter plus strict pour les endpoints SSE (streams).
 * Les connexions SSE restent ouvertes longtemps, donc on limite le nombre de connexions.
 */
export const streamLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: Math.floor(config.rateLimit.max / 10), // 10x plus strict
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many stream connections",
    },
  },
  skip: () => !config.rateLimit.enabled,
});
