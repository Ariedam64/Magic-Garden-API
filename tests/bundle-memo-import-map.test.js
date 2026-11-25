// tests/bundle-memo-import-map.test.js
//
// 2198 (2026-11-24) : le jeu a publié une nouvelle version sans changer
// `index-wq8PvQCa.js` — seule l import map de la page a bougé
// (`tools-Dad4Yb6o.js` -> `tools-BE-nfbKv.js` en 2184, `tools-DlkITWDy.js` en
// 2198). Le mémo des chunks résolus était indexé sur la seule URL de l index :
// il a continué de rendre les fichiers de la 2184, toujours servis et toujours
// valides pour leurs tests, et /data est resté sur l ancienne version (pas
// d AmberboundPotion) jusqu au redémarrage.

import test from "node:test";
import assert from "node:assert/strict";

import { fetchMainBundle } from "../src/core/game/bundle/resolver.js";

const ORIGIN = "https://game.test";
const ASSETS = `${ORIGIN}/runtime-assets/assets/`;

const page = (served) =>
  `<script type="importmap">{"imports":{"/runtime-assets/assets/tools-Written.js":"/runtime-assets/assets/${served}"}}</script>` +
  `<script type="module" crossorigin src="/runtime-assets/assets/index-Same.js"></script>`;

const FILES = {
  [`${ORIGIN}/version/1/index.html`]: page("tools-Old.js"),
  [`${ORIGIN}/version/2/index.html`]: page("tools-New.js"),
  [`${ASSETS}index-Same.js`]: "import(`./tools-Written.js`)",
  [`${ASSETS}tools-Old.js`]: "var a={Egg:{secondsToHatch:1}},v=`old`;",
  [`${ASSETS}tools-New.js`]: "var a={Egg:{secondsToHatch:1}},v=`new`;",
};

test("le mémo des chunks ne survit pas à un changement d import map", async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = FILES[String(url)];
    return body === undefined
      ? { ok: false, status: 404, statusText: "Not Found" }
      : { ok: true, status: 200, text: async () => body };
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const first = await fetchMainBundle(`${ORIGIN}/version/1/index.html`);
  assert.equal(first.mainUrl, `${ASSETS}tools-Old.js`);

  const second = await fetchMainBundle(`${ORIGIN}/version/2/index.html`);
  assert.equal(second.mainUrl, `${ASSETS}tools-New.js`);
  assert.match(second.mainJs, /`new`/);
  assert.notEqual(second.signature, first.signature);

  // Même page relue : le mémo sert toujours (signature stable).
  const third = await fetchMainBundle(`${ORIGIN}/version/2/index.html`);
  assert.equal(third.signature, second.signature);
});
