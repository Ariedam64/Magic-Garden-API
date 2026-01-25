// src/core/parsers/weather.js

import { BaseParser } from "./base.js";

/**
 * Formate la météo dans un format lisible.
 */
function formatWeather(value) {
  if (value == null) return "Clear Skies";

  const raw = String(value || "").trim();
  if (!raw) return "Clear Skies";

  const key = raw.toLowerCase();

  switch (key) {
    case "sunny":
      return "Clear Skies";
    case "rain":
      return "Rain";
    case "frost":
      return "Snow";
    case "amber moon":
      return "Amber Moon";
    case "dawn":
      return "Dawn";
    default:
      return raw;
  }
}

/**
 * Parser pour les données météo.
 *
 * Events:
 * - weather: Émis quand la météo change (string)
 */
export class WeatherParser extends BaseParser {
  constructor() {
    super();
    this.weather = null;
  }

  /**
   * Retourne la météo actuelle.
   */
  getWeather() {
    return this.weather;
  }

  /**
   * Traite un message WebSocket.
   */
  handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    // Welcome = full state
    if (msg.type === "Welcome" && msg.fullState) {
      const game = msg.fullState?.child?.data || null;
      if (!game) return;

      if ("weather" in game) {
        const next = formatWeather(game.weather);
        if (next !== this.weather) {
          this.weather = next;
          this.emit("weather", next);
        }
      }
      return;
    }

    // PartialState = patches
    if (msg.type !== "PartialState" || !Array.isArray(msg.patches)) return;

    for (const p of msg.patches) {
      if (!p || typeof p.path !== "string") continue;

      if (p.path === "/child/data/weather") {
        const next = formatWeather(p.value);
        if (next !== this.weather) {
          this.weather = next;
          this.emit("weather", next);
        }
        return;
      }
    }
  }
}
