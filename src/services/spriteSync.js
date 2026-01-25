// src/services/spriteSync.js

import { config } from "../config/index.js";
import { logger } from "../logger/index.js";
import { CloseCodes } from "../core/websocket/closeCodes.js";
import { exportSpritesToDisk } from "../assets/sprites/exportSpritesToDisk.js";

const VERSION_MISMATCH_CODES = new Set([CloseCodes.VERSION_MISMATCH, CloseCodes.VERSION_EXPIRED]);

let isExporting = false;
const EXPORT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Handle version mismatch by exporting sprites and restarting.
 */
async function handleVersionMismatch() {
  if (isExporting) {
    logger.warn("Sprite export already in progress, ignoring duplicate request");
    return;
  }

  isExporting = true;

  const timeout = setTimeout(() => {
    logger.error("Sprite export timeout after 5 minutes, forcing exit");
    process.exit(1);
  }, EXPORT_TIMEOUT);

  try {
    logger.warn({ exportDir: config.sprites.exportDir }, "Version mismatch detected - starting sprite export");

    const startTime = Date.now();
    const result = await exportSpritesToDisk({
      outDir: config.sprites.exportDir,
      restoreTrim: true,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - startTime;

    logger.info(
      {
        exported: result.exported,
        atlases: result.atlases,
        outDir: result.outDir,
        elapsedMs: elapsed,
      },
      "Sprite export completed successfully"
    );

    logger.info("Restarting server in 1 second...");

    // Give time for logs to flush
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    clearTimeout(timeout);

    logger.error(
      { error: error?.message || String(error) },
      "Sprite export failed - will not restart"
    );

    isExporting = false;
  }
}

/**
 * Register listener for version mismatch close codes.
 * Attach to WebSocket connection instance.
 */
export function registerSpriteSyncListener(mgConnection) {
  if (!mgConnection) {
    logger.warn("Invalid WebSocket connection, sprite sync listener not registered");
    return;
  }

  logger.info("Sprite sync listener registered - watching for codes 4700 (VERSION_MISMATCH) and 4710 (VERSION_EXPIRED)");

  mgConnection.on("close", ({ code, reason }) => {
    logger.info({ code, reason }, "WebSocket close event received by sprite sync listener");

    if (VERSION_MISMATCH_CODES.has(code)) {
      const codeName = code === CloseCodes.VERSION_MISMATCH ? "VERSION_MISMATCH (4700)" : "VERSION_EXPIRED (4710)";
      logger.warn({ code, codeName, reason }, "VERSION MISMATCH DETECTED - Triggering sprite sync");

      handleVersionMismatch().catch((err) => {
        logger.error({ error: err?.message }, "Unexpected error in version mismatch handler");
      });
    }
  });
}
