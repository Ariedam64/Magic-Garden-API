// src/api/routes/weatherStation.js

import express from "express";
import { asyncHandler, Errors } from "../middleware/index.js";
import { weatherStationService } from "../../services/weatherStation.js";
import {
  DAY_MS,
  ENGINE_SIGNATURE,
  ERAS,
  MODELED_FROM,
  dayKeyToMs,
  isValidDayKey,
  tzOffsetMs,
  utcDayKey,
} from "../../core/weather/index.js";
import { applyCacheHeaders, buildWeakEtag, isFresh } from "../../utils/httpCache.js";
import { jsonToCsv, sendCsv, jsonToTsv, sendTsv } from "../../utils/csvConverter.js";

export const weatherStationRouter = express.Router();

const MAX_RANGE_DAYS = 400;
const MAX_ACCURACY_DAYS = 31;
const DEFAULT_FORECAST_MS = DAY_MS;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_UPCOMING = 50;

// Une fenêtre passée est figée (le moteur est déterministe et l'ère qui la
// couvre est close) ; le futur peut bouger si une ère est ajoutée.
const PAST_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=3600";
const FUTURE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60";

// =====================
// Validation
// =====================

function parseTimestamp(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^-?\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTz(raw) {
  const tz = raw ? String(raw) : "UTC";
  try {
    return { tz, offsetMs: tzOffsetMs(tz, Date.now()) };
  } catch {
    throw Errors.badRequest(`Unknown timezone: ${tz}`);
  }
}

function resolveEngine(raw) {
  if (!raw) return null;
  const id = String(raw);
  if (!ERAS.some((era) => era.id === id)) {
    throw Errors.badRequest(`Unknown engine: ${id}. Known engines: ${ERAS.map((e) => e.id).join(", ")}`);
  }
  return id;
}

function resolveIds(raw) {
  if (!raw) return null;
  const { ids, unknown } = weatherStationService.resolveWeatherIds(raw);
  if (unknown.length) throw Errors.badRequest(`Unknown weather: ${unknown.join(", ")}`);
  return ids.size ? ids : null;
}

/**
 * Fenêtre de prévision. Sans paramètre : les 24 prochaines heures — une station
 * météo parle du futur par défaut, contrairement aux routes `/stats`.
 */
function resolveForecastRange({ from, to }, { maxDays = MAX_RANGE_DAYS } = {}) {
  const now = Date.now();
  const fromTs = parseTimestamp(from) ?? now;
  const toTs = parseTimestamp(to) ?? fromTs + DEFAULT_FORECAST_MS;

  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
    throw Errors.badRequest("`from` and `to` must be epoch ms or ISO dates");
  }
  if (fromTs >= toTs) throw Errors.badRequest("`from` must be < `to`");
  if (toTs - fromTs > maxDays * DAY_MS) {
    throw Errors.badRequest(`Range too wide (max ${maxDays} days)`);
  }

  return { from: fromTs, to: toTs };
}

function resolveLimit(raw) {
  const n = raw == null || raw === "" ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function resolveCount(raw) {
  const n = raw == null || raw === "" ? 5 : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.floor(n), MAX_UPCOMING);
}

const wantsEnrichment = (raw) => raw !== "0" && raw !== "false";

/**
 * Cache conditionnel pour les vues déterministes (prévision, journée).
 * @returns {boolean} true si un 304 a été renvoyé.
 */
function applyForecastCache(req, res, { parts, isPast }) {
  const etag = buildWeakEtag("weather-station", ENGINE_SIGNATURE, ...parts);
  const cacheControl = isPast ? PAST_CACHE_CONTROL : FUTURE_CACHE_CONTROL;

  if (isFresh(req, etag)) {
    applyCacheHeaders(res, { etag, cacheControl });
    res.status(304).end();
    return true;
  }

  applyCacheHeaders(res, { etag, cacheControl });
  return false;
}

// =====================
// Snapshot
// =====================

// GET /weather-station - tableau de bord complet (présent + à venir + jour + précision)
weatherStationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { tz, offsetMs } = resolveTz(req.query.tz);
    const engineId = resolveEngine(req.query.engine);

    const station = await weatherStationService.getStation({
      tz,
      tzOffset: offsetMs,
      engineId,
      upcoming: resolveCount(req.query.upcoming),
      enrich: wantsEnrichment(req.query.enrich),
    });

    applyCacheHeaders(res, { cacheControl: "no-store" });
    res.json(station);
  })
);

// GET /weather-station/now - météo courante + prochain évènement (léger, pour du polling)
weatherStationRouter.get(
  "/now",
  asyncHandler(async (req, res) => {
    const engineId = resolveEngine(req.query.engine);

    const now = await weatherStationService.getNow({
      engineId,
      enrich: wantsEnrichment(req.query.enrich),
    });

    applyCacheHeaders(res, { cacheControl: "no-store" });
    res.json(now);
  })
);

// GET /weather-station/next?ids=AmberMoon,Rain&count=5 - prochaines occurrences
weatherStationRouter.get(
  "/next",
  asyncHandler(async (req, res) => {
    const engineId = resolveEngine(req.query.engine);
    const ids = resolveIds(req.query.ids);
    const count = resolveCount(req.query.count);
    const enrich = wantsEnrichment(req.query.enrich);
    const from = parseTimestamp(req.query.from) ?? Date.now();

    if (!Number.isFinite(from)) throw Errors.badRequest("`from` must be epoch ms or an ISO date");

    const meta = enrich ? await weatherStationService.getWeatherMeta() : null;
    const { events, scanned_days, complete } = weatherStationService.nextEvents(from, { count, ids, engineId });

    applyCacheHeaders(res, { cacheControl: "no-store" });
    res.json({
      from,
      count: events.length,
      requested: count,
      complete,
      scanned_days,
      ...(ids ? { ids: [...ids] } : {}),
      events: events.map((event) => weatherStationService.serializeEvent(event, { meta, now: from, enrich })),
    });
  })
);

// =====================
// Prévision
// =====================

async function buildForecast(req) {
  const engineId = resolveEngine(req.query.engine);
  const ids = resolveIds(req.query.ids);
  const limit = resolveLimit(req.query.limit);
  const enrich = wantsEnrichment(req.query.enrich);
  const includeClear = req.query.include_clear === "1" || req.query.include_clear === "true";
  const { from, to } = resolveForecastRange(req.query);

  const meta = enrich ? await weatherStationService.getWeatherMeta() : null;

  const source = includeClear
    ? weatherStationService.timelineBetween(from, to, { engineId })
    : weatherStationService.eventsBetween(from, to, { engineId });
  const entries = includeClear ? source.timeline : source.events;

  const filtered = ids ? entries.filter((event) => ids.has(event.id)) : entries;
  const truncated = filtered.length > limit;

  return {
    from,
    to,
    engine: engineId || source.eras.join("→") || null,
    eras: source.eras,
    modeled: source.modeled,
    modeled_from: MODELED_FROM,
    count: Math.min(filtered.length, limit),
    limit,
    truncated,
    ...(ids ? { ids: [...ids] } : {}),
    events: filtered
      .slice(0, limit)
      .map((event) =>
        weatherStationService.serializeEvent(event, { meta, clipFrom: from, clipTo: to, enrich })
      ),
  };
}

// GET /weather-station/forecast?from=&to=&ids=&limit=&include_clear=1
weatherStationRouter.get(
  "/forecast",
  asyncHandler(async (req, res) => {
    const forecast = await buildForecast(req);

    // L'ETag porte sur la fenêtre **résolue**, pas sur la query : sans `from`,
    // la fenêtre par défaut glisse avec l'horloge, et un ETag calculé sur une
    // query vide ferait servir indéfiniment la première prévision.
    if (applyForecastCache(req, res, {
      parts: [
        forecast.from, forecast.to, forecast.engine || "auto",
        (forecast.ids || []).join(","), forecast.limit,
        req.query.include_clear ? "1" : "0", req.query.enrich === "0" ? "0" : "1",
      ],
      isPast: forecast.to <= Date.now(),
    })) return;

    res.json(forecast);
  })
);

/**
 * Export délimité : chaque évènement devient une ligne, clé = début ISO (unique,
 * un seul évènement peut commencer à un instant donné).
 */
function makeForecastExportHandler(format) {
  const { convert, send } = format === "csv"
    ? { convert: jsonToCsv, send: sendCsv }
    : { convert: jsonToTsv, send: sendTsv };

  return asyncHandler(async (req, res) => {
    const forecast = await buildForecast(req);

    // `jsonToDelimited` réserve la propriété `id` de chaque ligne à la colonne
    // clé : l'id de la météo est renommé pour ne pas l'écraser.
    const rows = {};
    for (const event of forecast.events) {
      const { started_at_iso: key, id, ...rest } = event;
      rows[key] = { weather_id: id, ...rest };
    }

    const filename = `weather_forecast_${utcDayKey(forecast.from)}_${utcDayKey(forecast.to)}.${format}`;
    send(res, convert(rows, { idColumn: "started_at_iso" }), filename);
  });
}

weatherStationRouter.get("/forecast.csv", makeForecastExportHandler("csv"));
weatherStationRouter.get("/forecast.tsv", makeForecastExportHandler("tsv"));

// =====================
// Journée
// =====================

// GET /weather-station/day/:date?tz=Europe/Paris - la journée civile complète
weatherStationRouter.get(
  "/day/:date",
  asyncHandler(async (req, res) => {
    const dayKey = String(req.params.date);
    if (!isValidDayKey(dayKey)) throw Errors.badRequest("`date` must be a YYYY-MM-DD day");

    const engineId = resolveEngine(req.query.engine);
    const enrich = wantsEnrichment(req.query.enrich);

    // L'offset est résolu à midi du jour demandé pour que l'heure d'été soit
    // celle de CE jour-là, pas celle d'aujourd'hui.
    const { tz, offsetMs } = (() => {
      const raw = req.query.tz ? String(req.query.tz) : "UTC";
      try {
        return { tz: raw, offsetMs: tzOffsetMs(raw, dayKeyToMs(dayKey) + DAY_MS / 2) };
      } catch {
        throw Errors.badRequest(`Unknown timezone: ${raw}`);
      }
    })();

    const from = dayKeyToMs(dayKey) - offsetMs;
    const to = from + DAY_MS;

    if (applyForecastCache(req, res, {
      parts: [dayKey, tz, engineId || "auto", enrich ? "1" : "0"],
      isPast: to <= Date.now(),
    })) return;

    const meta = enrich ? await weatherStationService.getWeatherMeta() : null;
    const { timeline, modeled, eras } = weatherStationService.timelineBetween(from, to, { engineId });
    const { counts, minutes } = weatherStationService.summarize(timeline);
    const now = Date.now();

    res.json({
      day: dayKey,
      tz,
      tz_offset_min: Math.round(offsetMs / 60_000),
      from,
      to,
      engine: engineId || eras.join("→") || null,
      eras,
      modeled,
      modeled_from: MODELED_FROM,
      counts,
      minutes,
      timeline: timeline.map((event) =>
        weatherStationService.serializeEvent(event, { meta, now, clipFrom: from, clipTo: to, enrich })
      ),
    });
  })
);

// =====================
// Moteur & précision
// =====================

// GET /weather-station/engine - registre des ères + état du contrôle de dérive
weatherStationRouter.get("/engine", (_req, res) => {
  applyCacheHeaders(res, { cacheControl: FUTURE_CACHE_CONTROL });
  res.json({ ...weatherStationService.getEngineInfo(), drift: weatherStationService.checkDrift() });
});

// GET /weather-station/accuracy?from=&to= - moteur vs historique enregistré
weatherStationRouter.get("/accuracy", (req, res) => {
  const now = Date.now();
  const to = parseTimestamp(req.query.to) ?? now;
  const from = parseTimestamp(req.query.from) ?? to - DAY_MS;

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw Errors.badRequest("`from` and `to` must be epoch ms or ISO dates");
  }
  if (from >= to) throw Errors.badRequest("`from` must be < `to`");
  if (to - from > MAX_ACCURACY_DAYS * DAY_MS) {
    throw Errors.badRequest(`Range too wide (max ${MAX_ACCURACY_DAYS} days)`);
  }

  applyCacheHeaders(res, { cacheControl: "public, max-age=60" });
  res.json(weatherStationService.accuracy({ from, to }));
});
