// src/core/websocket/connection.js

import EventEmitter from "node:events";
import WebSocket from "ws";

import { config } from "../../config/index.js";
import { logger } from "../../logger/index.js";
import { fetchGameVersion } from "../game/version.js";
import { saveVersion } from "../game/versionStorage.js";
import { generatePlayerId, generateRoomId } from "../../utils/id.js";
import { buildMagicGardenWsUrl } from "./url.js";
import { shouldReconnect, getReconnectDelayMs } from "./reconnect.js";

const DEFAULT_ANONYMOUS_USER_STYLE = Object.freeze({
  avatarBottom: "Bottom_DefaultGray.png",
  avatarExpression: "Expression_Default.png",
  avatarMid: "Mid_DefaultGray.png",
  avatarTop: "Top_DefaultGray.png",
  color: "Orange",
  name: "Arie API",
});

/**
 * Connexion WebSocket au jeu Magic Garden.
 */
export class MagicGardenConnection extends EventEmitter {
  constructor({
    origin = config.game.origin,
    autoReconnect = config.websocket.autoReconnect,
    maxRetries = config.websocket.maxRetries,
    minDelay = config.websocket.minDelay,
    maxDelay = config.websocket.maxDelay,
    anonymousUserStyle = DEFAULT_ANONYMOUS_USER_STYLE,
  } = {}) {
    super();

    this.origin = origin;
    this.autoReconnect = autoReconnect;
    this.maxRetries = maxRetries;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.anonymousUserStyle = anonymousUserStyle;

    this.ws = null;
    this.manualStop = false;
    this.retryCount = 0;

    this.playerId = generatePlayerId();
    this.roomId = generateRoomId();

    this.version = null;
    this.url = null;

    this.reconnectTimer = null;
    this.queue = [];
  }

  /**
   * Retourne le statut actuel de la connexion.
   */
  status() {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      connecting: this.ws?.readyState === WebSocket.CONNECTING,
      retryCount: this.retryCount,
      origin: this.origin,
      url: this.url,
      version: this.version,
      roomId: this.roomId,
      playerId: this.playerId,
    };
  }

  /**
   * Établit la connexion WebSocket.
   */
  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.manualStop = false;

    // Récupère la version du jeu
    this.version = await fetchGameVersion({ origin: this.origin });

    // Sauvegarde la version
    await saveVersion(this.version);

    // Construit l'URL WebSocket
    this.url = buildMagicGardenWsUrl({
      origin: this.origin,
      version: this.version,
      roomId: this.roomId,
      playerId: this.playerId,
      anonymousUserStyle: this.anonymousUserStyle,
    });

    logger.info({ url: this.url }, "Connecting to WebSocket");

    const ws = new WebSocket(this.url, {});
    this.ws = ws;

    ws.on("open", () => {
      this.retryCount = 0;
      logger.info({ roomId: this.roomId }, "WebSocket connected");
      this.emit("open", this.status());

      // Flush la queue de messages
      while (this.queue.length && ws.readyState === WebSocket.OPEN) {
        ws.send(this.queue.shift());
      }
    });

    ws.on("message", (data) => {
      const msg = data.toString();

      // Heartbeat ping/pong
      if (msg === "ping") {
        if (ws.readyState === WebSocket.OPEN) ws.send("pong");
        return;
      }

      this.emit("message", msg);
    });

    ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf?.toString?.() || "";
      logger.info({ code, reason }, "WebSocket closed");
      this.emit("close", { code, reason });

      if (!shouldReconnect({
        autoReconnect: this.autoReconnect,
        manualStop: this.manualStop,
        closeCode: code,
      })) {
        return;
      }

      this.scheduleReconnect(code);
    });

    ws.on("error", (err) => {
      logger.error({ err: err.message }, "WebSocket error");
      this.emit("error", err);
    });
  }

  /**
   * Planifie une tentative de reconnexion.
   */
  scheduleReconnect(closeCode) {
    if (this.reconnectTimer) return;
    if (this.retryCount >= this.maxRetries) {
      logger.warn({ maxRetries: this.maxRetries }, "Max reconnect attempts reached");
      return;
    }

    this.retryCount++;

    const delay = getReconnectDelayMs(this.retryCount, {
      minDelay: this.minDelay,
      maxDelay: this.maxDelay,
    });

    logger.info({ attempt: this.retryCount, delay, closeCode }, "Scheduling reconnect");
    this.emit("reconnect", { attempt: this.retryCount, delay, closeCode });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => this.emit("error", err));
    }, delay);
  }

  /**
   * Envoie un message sur le WebSocket.
   */
  send(data) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return true;
    }

    // Met en queue si pas connecté
    this.queue.push(payload);
    return false;
  }

  /**
   * Ferme la connexion.
   */
  stop(code = 1000, reason = "Client stop") {
    this.manualStop = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws?.close(code, reason);
    } catch {
      // Ignore
    }

    logger.info("WebSocket stopped");
  }
}
