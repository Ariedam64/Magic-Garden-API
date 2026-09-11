// src/core/weather/index.js

export {
  SLOT_MS,
  SLOTS_PER_DAY,
  DAY_MS,
  dayKeyToMs,
  utcDayKey,
  isValidDayKey,
  slotToUtcTime,
  tzOffsetMs,
} from "./days.js";

export {
  ERAS,
  MODELED_FROM,
  ENGINE_SIGNATURE,
  WEATHER_DISPLAY,
  CLEAR_SKIES,
  REALITY_PATCHES,
  canonicalWeatherKey,
  eraAt,
  eraById,
  eraFor,
  erasForDay,
  groupIndex,
} from "./eras.js";

export { predictDay, predictRange } from "./schedule.js";
