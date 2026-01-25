// src/core/parsers/index.js

import { BaseParser, applyPatch } from "./base.js";
import { ShopParser } from "./shop.js";
import { WeatherParser } from "./weather.js";

// Re-exports
export { BaseParser, applyPatch, ShopParser, WeatherParser };

// Registry des parsers disponibles
export const ParserRegistry = {
  shop: ShopParser,
  weather: WeatherParser,
};
