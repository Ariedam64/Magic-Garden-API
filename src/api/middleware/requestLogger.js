// src/api/middleware/requestLogger.js

import { logger } from "../../logger/index.js";

/**
 * Middleware de logging des requêtes HTTP.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();

  // Log à la fin de la requête
  res.on("finish", () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? "warn" : "info";

    logger[level]({
      req: {
        method: req.method,
        path: req.path,
        query: Object.keys(req.query).length ? req.query : undefined,
      },
      res: {
        status: res.statusCode,
        duration: `${duration}ms`,
      },
    });
  });

  next();
}
