// src/api/routes/stats.js

import express from "express";
import {
  validateShop,
  resolveRange,
  resolveBucket,
  resolveLimit,
  queryItemsTimeseries,
  queryItemsStats,
  queryWeatherStats,
  queryWeatherTimeseries,
  queryWeatherEvents,
  queryShopRestocks,
} from "../../services/historyQueries.js";

export const statsRouter = express.Router();

function parseIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function handleValidationError(err, res) {
  if (err?.code === "BAD_SHOP" || err?.code === "BAD_BUCKET" || err?.code === "BAD_RANGE" || err?.code === "TOO_MANY_BUCKETS") {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: "Internal error" });
}

// GET /stats/items/timeseries?shop=seed&ids=Carrot,Strawberry&from=...&to=...&bucket=day
statsRouter.get("/items/timeseries", (req, res) => {
  try {
    const shop = validateShop(String(req.query.shop || ""));
    const ids = parseIds(req.query.ids);
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });
    const { bucket, ms } = resolveBucket(req.query.bucket, { from, to });

    const series = queryItemsTimeseries({ shop, ids, from, to, bucket, bucketMs: ms });

    res.json({ shop, bucket, from, to, series });
  } catch (err) {
    handleValidationError(err, res);
  }
});

// GET /stats/items?shop=seed&from=...&to=...&sort=appearances&order=asc
statsRouter.get("/items", (req, res) => {
  try {
    const shop = validateShop(String(req.query.shop || ""));
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });
    const sort = req.query.sort ? String(req.query.sort) : "appearances";
    const order = req.query.order ? String(req.query.order) : "asc";

    const { total_restocks, items } = queryItemsStats({ shop, from, to, sort, order });

    res.json({ shop, from, to, total_restocks, items });
  } catch (err) {
    handleValidationError(err, res);
  }
});

// GET /stats/weather/timeseries?from=...&to=...&bucket=day
statsRouter.get("/weather/timeseries", (req, res) => {
  try {
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });
    const { bucket, ms } = resolveBucket(req.query.bucket, { from, to });

    const points = queryWeatherTimeseries({ from, to, bucketMs: ms });

    res.json({ bucket, from, to, points });
  } catch (err) {
    handleValidationError(err, res);
  }
});

// GET /stats/weather?from=...&to=...
statsRouter.get("/weather", (req, res) => {
  try {
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });

    const { total_duration, weathers } = queryWeatherStats({ from, to });

    res.json({ from, to, total_duration, weathers });
  } catch (err) {
    handleValidationError(err, res);
  }
});

// GET /stats/weather/events?from=...&to=...&limit=100&order=desc
statsRouter.get("/weather/events", (req, res) => {
  try {
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });
    const limit = resolveLimit(req.query.limit);
    const order = req.query.order ? String(req.query.order) : "desc";

    const events = queryWeatherEvents({ from, to, limit, order });

    res.json({ from, to, count: events.length, limit, events });
  } catch (err) {
    handleValidationError(err, res);
  }
});

// GET /stats/shops/restocks?shop=seed&from=...&to=...&limit=100&order=desc
statsRouter.get("/shops/restocks", (req, res) => {
  try {
    const shop = validateShop(String(req.query.shop || ""));
    const { from, to } = resolveRange({ from: req.query.from, to: req.query.to });
    const limit = resolveLimit(req.query.limit);
    const order = req.query.order ? String(req.query.order) : "desc";

    const restocks = queryShopRestocks({ shop, from, to, limit, order });

    res.json({ shop, from, to, count: restocks.length, limit, restocks });
  } catch (err) {
    handleValidationError(err, res);
  }
});
