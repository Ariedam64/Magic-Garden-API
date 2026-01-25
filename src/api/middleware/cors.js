// src/api/middleware/cors.js

import cors from "cors";
import { config } from "../../config/index.js";

/**
 * Middleware CORS.
 * Configure les headers Cross-Origin Resource Sharing.
 */
export const corsMiddleware = cors({
  origin: config.cors.origin,
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  credentials: false,
  maxAge: 86400, // 24h preflight cache
});
