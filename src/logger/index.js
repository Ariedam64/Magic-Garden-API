// src/logger/index.js

import pino from "pino";
import { config } from "../config/index.js";

const transport = config.logging.pretty
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    }
  : undefined;

export const logger = pino({
  level: config.logging.level,
  transport,
});

// Raccourcis pour faciliter l'usage
export const log = {
  info: (msg, data) => logger.info(data, msg),
  warn: (msg, data) => logger.warn(data, msg),
  error: (msg, data) => logger.error(data, msg),
  debug: (msg, data) => logger.debug(data, msg),
};
