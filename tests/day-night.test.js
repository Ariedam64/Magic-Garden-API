// tests/day-night.test.js
//
// Cycle jour/nuit du Haunt Event. Les instants de référence viennent de
// l'historique : le Spooky Shop, qui ouvre au coucher du soleil, a ouvert le
// 2026-10-16 à 21:40 et le 2026-10-17 à 07:40 UTC.

import test from "node:test";
import assert from "node:assert/strict";

import {
  dayNightAt,
  extractStageMinutes,
  hauntsAt,
  nightsFrom,
  nextSpookyShopOpening,
  HAUNT_EVENT,
} from "../src/core/weather/dayNight.js";

const at = (iso) => Date.parse(iso);

test("sunset starts exactly when the Spooky Shop opened", () => {
  for (const iso of ["2026-10-16T21:40:00Z", "2026-10-17T07:40:00Z"]) {
    const state = dayNightAt(at(iso));
    assert.equal(state.stage, "sunset", iso);
    assert.equal(state.stage_started_at, at(iso));
  }
});

test("stages follow sunset, midnight, sunrise, day", () => {
  assert.equal(dayNightAt(at("2026-10-17T07:39:59Z")).stage, "day");
  assert.equal(dayNightAt(at("2026-10-17T07:50:00Z")).stage, "midnight");
  assert.equal(dayNightAt(at("2026-10-17T08:00:00Z")).stage, "sunrise");
  assert.equal(dayNightAt(at("2026-10-17T08:10:00Z")).stage, "day");
});

test("darkness follows the game's curve and the nocturnal bonus its stage", () => {
  assert.equal(dayNightAt(at("2026-10-17T12:00:00Z")).darkness, 0);
  assert.equal(dayNightAt(at("2026-10-17T07:45:00Z")).darkness, 0.5);
  assert.equal(dayNightAt(at("2026-10-17T07:55:00Z")).darkness, 1);
  assert.equal(dayNightAt(at("2026-10-17T07:55:00Z")).nocturnal_strength_bonus, 20);
  assert.equal(dayNightAt(at("2026-10-17T12:00:00Z")).nocturnal_strength_bonus, 0);
});

test("nights come every 10 hours and last 30 minutes, the current one included", () => {
  const nights = nightsFrom(at("2026-10-17T08:05:00Z"), 2);
  assert.equal(new Date(nights[0].sunset_at).toISOString(), "2026-10-17T07:40:00.000Z");
  assert.equal(new Date(nights[0].ends_at).toISOString(), "2026-10-17T08:10:00.000Z");
  assert.equal(new Date(nights[1].sunset_at).toISOString(), "2026-10-17T17:40:00.000Z");
  assert.equal(nights[1].ends_at - nights[1].sunset_at, 30 * 60_000);
});

test("the next Spooky Shop opening is the next sunset, until the event ends", () => {
  assert.equal(nextSpookyShopOpening(at("2026-10-17T14:00:00Z")), at("2026-10-17T17:40:00Z"));
  assert.equal(nextSpookyShopOpening(HAUNT_EVENT.endsAt), null);
});

test("haunts show at night, during weather, and never after the event", () => {
  assert.equal(hauntsAt(at("2026-10-17T12:00:00Z"), { stage: "day" }).active, false);
  assert.equal(hauntsAt(at("2026-10-17T12:00:00Z"), { stage: "day", weatherActive: true }).visible_fraction, 0.25);
  assert.equal(hauntsAt(at("2026-10-17T07:55:00Z"), { stage: "midnight", weatherActive: true }).visible_fraction, 0.5);
  assert.equal(hauntsAt(HAUNT_EVENT.endsAt, { stage: "midnight" }).active, false);
});

test("stage lengths are read from the bundle, not from the nocturnal bonus table", () => {
  // Forme réelle 1608 : les deux tables cohabitent dans le bundle.
  const source =
    "var yo={day:0,sunset:15,midnight:20,sunrise:10};" +
    "var xt=[`grid`,`list`],St={day:570,sunset:10,midnight:10,sunrise:10},Ct=1;";
  assert.deepEqual(extractStageMinutes(source), { day: 570, sunset: 10, midnight: 10, sunrise: 10 });
  assert.equal(extractStageMinutes("var yo={day:0,sunset:15,midnight:20,sunrise:10};"), null);
  assert.equal(extractStageMinutes(null), null);
});

test("a different cycle from the bundle is honoured", () => {
  const stages = { day: 50, sunset: 5, midnight: 5, sunrise: 10 };
  assert.equal(dayNightAt(0, stages).cycle_ms, 70 * 60_000);
});
