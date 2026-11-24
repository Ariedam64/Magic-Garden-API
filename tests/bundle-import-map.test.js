// tests/bundle-import-map.test.js
//
// Depuis 2175 la page du jeu porte une import map : les noms de chunks écrits
// dans le code (`./bootstrap-CCFs2xWV.js`) ne sont plus les fichiers servis
// (`bootstrap-BSKeyB-n.js`), et le nom écrit répond 404. Sans la map, la
// traversée s'arrêtait au premier lien : « Game data chunk not found in bundle
// graph », et toutes les routes /data/* en 500.
//
// Extraits réels du build 2184.

import test from "node:test";
import assert from "node:assert/strict";

import { parseImportMap, collectChunkRefs, withImportMapAliases } from "../src/core/game/bundle/resolver.js";

const PAGE_URL = "https://magicgarden.gg/version/2184/index.html";
const ASSETS = "https://magicgarden.gg/runtime-assets/assets/";
const INDEX_URL = `${ASSETS}index-wq8PvQCa.js`;
const BASE = "https://magicgarden.gg/runtime-assets/";

const PAGE = '<!doctype html> <html lang="en" translate="no"> <head>\n<script type="importmap">{"imports":{"/runtime-assets/assets/index-C1TLYQNg.js":"/runtime-assets/assets/index-wq8PvQCa.js","/runtime-assets/assets/bootstrap-CCFs2xWV.js":"/runtime-assets/assets/bootstrap-BSKeyB-n.js","/runtime-assets/assets/tools-Dad4Yb6o.js":"/runtime-assets/assets/tools-BE-nfbKv.js"}}</script>\n   <script type="module" crossorigin src="/runtime-assets/assets/index-wq8PvQCa.js"></script>';

const INDEX = "window.__MAGICCIRCLE_UNSUPPORTED_BROWSER__||a(()=>import(`./bootstrap-CCFs2xWV.js`).then(function(e){return e.start()}),__vite__mapDeps([0,1,2,3,4]),import.meta.url);export{a as t};";

test("lit l'import map de la page, en URL absolues", () => {
  const map = parseImportMap(PAGE, PAGE_URL);

  assert.equal(map.size, 3);
  assert.equal(map.get(`${ASSETS}bootstrap-CCFs2xWV.js`), `${ASSETS}bootstrap-BSKeyB-n.js`);
});

test("une page sans import map (builds < 2175) donne une map vide", () => {
  assert.equal(parseImportMap("<html><head></head></html>", PAGE_URL).size, 0);
});

test("une import map illisible n'interrompt pas la résolution", () => {
  assert.equal(parseImportMap('<script type="importmap">{oops</script>', PAGE_URL).size, 0);
});

test("les références suivent l'import map vers le fichier réellement servi", () => {
  const map = parseImportMap(PAGE, PAGE_URL);
  const urls = collectChunkRefs(INDEX, INDEX_URL, BASE, map).map((c) => c.url);

  assert.deepEqual(urls, [`${ASSETS}bootstrap-BSKeyB-n.js`]);
});

test("une référence absente de la map reste telle quelle", () => {
  const map = parseImportMap(PAGE, PAGE_URL);
  const urls = collectChunkRefs("import(`./other-Abc123.js`)", INDEX_URL, BASE, map).map((c) => c.url);

  assert.deepEqual(urls, [`${ASSETS}other-Abc123.js`]);
});

test("un chunk reste retrouvable sous le nom écrit dans le code", () => {
  // Les extracteurs suivent `import{..}from"./tools-Dad4Yb6o.js"` par nom de
  // fichier : le chunk téléchargé sous son nom réel doit répondre aux deux.
  const map = parseImportMap(PAGE, PAGE_URL);
  const chunks = [{ url: `${ASSETS}tools-BE-nfbKv.js`, content: "x" }];

  assert.deepEqual(withImportMapAliases(chunks, map), [
    { url: `${ASSETS}tools-BE-nfbKv.js`, content: "x" },
    { url: `${ASSETS}tools-Dad4Yb6o.js`, content: "x" },
  ]);
});
