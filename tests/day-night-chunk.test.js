// tests/day-night-chunk.test.js
//
// En 1737 la durée des phases jour/nuit est partie dans un chunk à elle
// (`dayNight-*.js`, importé par `bootstrap-*`) que le résolveur ne retenait
// pas : /weather-station/day-night servait `source: "default"`. Le jeu servi
// ci-dessous reprend la forme réelle 1778, en miniature.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";
import { extractStageMinutes } from "../src/core/weather/dayNight.js";

const ORIGIN = "https://game.test/version/9998/";
const FILES = {
  "index.html": '<script type="module" src="/version/9998/assets/index-a1.js"></script>',
  "assets/index-a1.js": 'import("./bootstrap-b2.js");',
  "assets/bootstrap-b2.js": 'const d=["assets/dayNight-c3.js","assets/petMotion-d4.js"];',
  "assets/dayNight-c3.js":
    "var e={day:570,sunset:10,midnight:10,sunrise:10},t=Object.values(e).reduce((e,t)=>e+t,0),n=t*6e4;",
  "assets/petMotion-d4.js":
    "var U={day:0,sunset:15,midnight:20,sunrise:10};var jt={CommonEgg:{name:`Common Egg`,secondsToHatch:600}};",
};

test("the stage lengths are read from their own chunk", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = FILES[String(url).slice(ORIGIN.length)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };

  try {
    const { weathersSource, dataSources } = await fetchMainBundle(`${ORIGIN}index.html`);
    const found = [weathersSource, ...dataSources].map(extractStageMinutes).find(Boolean);
    assert.deepEqual(found, { day: 570, sunset: 10, midnight: 10, sunrise: 10 });
  } finally {
    globalThis.fetch = realFetch;
  }
});
