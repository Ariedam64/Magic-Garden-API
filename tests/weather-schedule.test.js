// tests/weather-schedule.test.js
//
// Moteur météo déterministe. Deux familles de tests :
//   - invariants structurels du planning (hors réseau, hors DB) ;
//   - rejeu contre l'historique réellement enregistré, qui est le seul test qui
//     dise si le moteur décrit encore le jeu. Il est ignoré si la base
//     d'historique n'est pas là (clone frais, CI).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import {
  DAY_MS,
  SLOT_MS,
  SLOTS_PER_DAY,
  canonicalWeatherKey,
  dayKeyToMs,
  isValidDayKey,
  predictDay,
  predictRange,
  tzOffsetMs,
  utcDayKey,
} from "../src/core/weather/index.js";
import { resolveWeatherIds, timelineBetween, summarize } from "../src/services/weatherStation.js";

const DB_PATH = "./data/history.sqlite";
const SAMPLE_DAYS = ["2026-03-01", "2026-06-26", "2026-08-28", "2026-08-29", "2026-09-01"];

test("une journée prédite tient dans ses bornes et ne se chevauche pas", () => {
  for (const dayKey of SAMPLE_DAYS) {
    const day = predictDay(dayKey);
    const dayStart = dayKeyToMs(dayKey);

    assert.equal(day.modeled, true, `${dayKey} devrait être modélisé`);
    assert.ok(day.events.length > 0, `${dayKey} sans évènement`);

    let previousEnd = dayStart;
    for (const event of day.events) {
      assert.ok(event.startedAt >= dayStart, `${dayKey}: évènement avant 00:00`);
      assert.ok(event.endedAt <= dayStart + DAY_MS, `${dayKey}: évènement après 24:00`);
      assert.ok(event.startedAt >= previousEnd, `${dayKey}: chevauchement à ${event.startedAt}`);
      assert.equal(event.durationMin % 5, 0, `${dayKey}: durée non multiple de 5 min`);
      assert.equal((event.startedAt - dayStart) % SLOT_MS, 0, `${dayKey}: début hors slot`);
      assert.ok(["Hydro", "Lunar"].includes(event.group), `${dayKey}: groupe inconnu ${event.group}`);
      previousEnd = event.endedAt;
    }
  }
});

test("la prédiction est déterministe", () => {
  const first = predictDay("2026-09-01");
  const second = predictDay("2026-09-01");
  assert.deepEqual(first, second);
});

test("les évènements Lunar tombent sur les slots fixes (00:00, 04:00, ... 20:00)", () => {
  const day = predictDay("2026-09-01");
  const fixedSlots = new Set([0, 48, 96, 144, 192, 240]);

  for (const event of day.events) {
    if (event.group !== "Lunar") continue;
    assert.ok(fixedSlots.has(event.startSlot), `Lunar hors slot fixe: ${event.startSlot}`);
    assert.equal(event.durationMin, 10);
  }
});

test("les patches 'reality' ne s'appliquent qu'en mode auto", () => {
  // L'évènement Amber Moon force les slots Lunar du 29/08 ; le même jour simulé
  // sous v4 seul repasse au deck.
  const auto = predictDay("2026-08-29");
  const forced = predictDay("2026-08-29", { engineId: "v4" });

  const amberSlots = (day) =>
    day.events.filter((event) => event.id === "AmberMoon").map((event) => event.startSlot);

  assert.deepEqual(amberSlots(auto).slice(0, 5), [0, 48, 96, 144, 192]);
  assert.notDeepEqual(amberSlots(auto), amberSlots(forced));
});

test("un jour antérieur à la première ère n'est pas modélisé", () => {
  const day = predictDay("2026-01-01");
  assert.equal(day.modeled, false);
  assert.deepEqual(day.events, []);
  assert.deepEqual(day.eras, []);
});

test("un jour de transition d'ère référence les deux ères", () => {
  // v3 -> v4 a basculé le 2026-08-28 à 20:00Z.
  const day = predictDay("2026-08-28");
  assert.deepEqual(day.eras, ["v3", "v4"]);
  assert.equal(day.era, "v3→v4");
});

test("predictRange couvre chaque jour de la plage, bornes incluses", () => {
  const range = predictRange("2026-09-01", "2026-09-03");
  assert.deepEqual(range.days.map((day) => day.dayKey), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.ok(range.events.length >= range.days.length);
});

test("la chronologie d'une journée civile totalise 1440 minutes", () => {
  const offsetMs = tzOffsetMs("Europe/Paris", dayKeyToMs("2026-09-01") + DAY_MS / 2);
  const from = dayKeyToMs("2026-09-01") - offsetMs;
  const { timeline } = timelineBetween(from, from + DAY_MS);
  const { minutes } = summarize(timeline);

  const total = Object.values(minutes).reduce((sum, n) => sum + n, 0);
  assert.equal(total, 1440);
});

test("les clés de jour invalides sont rejetées", () => {
  assert.equal(isValidDayKey("2026-09-08"), true);
  assert.equal(isValidDayKey("2026-02-31"), false);
  assert.equal(isValidDayKey("2026-9-8"), false);
  assert.equal(isValidDayKey("hier"), false);
});

test("les noms de météo sont résolus par id et par libellé public", () => {
  assert.deepEqual([...resolveWeatherIds("Snow,Amber Moon,frost").ids], ["Frost", "AmberMoon"]);
  assert.deepEqual(resolveWeatherIds("Sunshine").unknown, ["Sunshine"]);
});

test("le moteur rejoue l'historique enregistré", { skip: !existsSync(DB_PATH) && "no history DB" }, () => {
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const to = Date.now();
    const from = to - 3 * DAY_MS;

    const recorded = db
      .prepare(
        `SELECT weather, started_at, ended_at FROM weather_events
         WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
         ORDER BY started_at ASC`
      )
      .all(to, from)
      .map((row) => ({ weather: row.weather, started_at: row.started_at, ended_at: row.ended_at ?? to }));

    if (recorded.length === 0) return; // base présente mais vide sur la fenêtre

    const days = new Map();
    const predictedAt = (ms) => {
      const key = utcDayKey(ms);
      if (!days.has(key)) days.set(key, predictDay(key));
      for (const event of days.get(key).events) {
        if (event.startedAt <= ms && ms < event.endedAt) return event.display;
      }
      return "Clear Skies";
    };
    const recordedAt = (ms) => {
      for (const event of recorded) {
        if (event.started_at <= ms && ms < event.ended_at) return event.weather;
        if (event.started_at > ms) break;
      }
      return null;
    };

    let covered = 0;
    let matched = 0;
    for (let ms = Math.ceil(from / SLOT_MS) * SLOT_MS; ms < to; ms += SLOT_MS) {
      const mid = ms + SLOT_MS / 2;
      const actual = recordedAt(mid);
      if (actual == null) continue;
      covered++;
      if (canonicalWeatherKey(actual) === canonicalWeatherKey(predictedAt(mid))) matched++;
    }

    assert.ok(covered > SLOTS_PER_DAY, `historique trop clairsemé pour conclure (${covered} slots)`);
    const pct = (100 * matched) / covered;
    assert.ok(pct >= 99, `précision tombée à ${pct.toFixed(2)}% (${matched}/${covered}) — le jeu a probablement changé son scheduler`);
  } finally {
    db.close();
  }
});
