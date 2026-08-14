// tests/bundle-chunk-refs.test.js
//
// La traversée du graphe de chunks casse à chaque changement de bundler du jeu.
// Ce test fige les formes d'entrée rencontrées jusqu'ici (extraits réels) : la
// collecte doit retrouver les chunks référencés pour toutes, sans code
// spécifique à un bundler.
//
// Historique des casses :
//   - Vite/rollup : __vite__mapDeps dans index.js, chemins en quotes doubles
//   - rolldown (v950) : index.js réduit à un `import()` dynamique relatif vers
//     un chunk "bootstrap", template literals, mapDeps descendu d'un niveau
//
// Quand le jeu changera encore de build, ajouter ici l'extrait qui casse avant
// de toucher au parser.

import test from "node:test";
import assert from "node:assert/strict";

import { collectChunkRefs } from "../src/core/game/bundle/resolver.js";

const BASE = "https://magicgarden.gg/version/950/";
const INDEX_URL = `${BASE}assets/index-BUKcTBI3.js`;

// Forme A : entrée Vite/rollup — tout le graphe listé dans __vite__mapDeps,
// chemins `assets/...` en quotes doubles (builds <= v9xx).
const VITE_INDEX = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/Loader-C0Iq2ntQ.js","assets/localization-C1ikogkU.js"])))=>i.map(i=>d[i]);';

// Forme B : entrée rolldown (v950) — plus aucun `assets/...`, juste un import()
// dynamique relatif, en template literals.
const ROLLDOWN_INDEX = "window.__MAGICCIRCLE_UNSUPPORTED_BROWSER__||r(()=>import(`./bootstrap-DGbYLg0G.js`),[]);export{r as t};";

// Forme C : chunk intermédiaire rolldown — mapDeps *et* imports relatifs.
const ROLLDOWN_BOOTSTRAP = 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/rolldown-runtime-CNC7AqOf.js","assets/localization-C1ikogkU.js"])))=>i.map(i=>d[i]);r(()=>import(`./Loader-C0Iq2ntQ.js`),[]);';

test("collecte les chunks d'une entrée Vite (__vite__mapDeps, quotes doubles)", () => {
  const urls = collectChunkRefs(VITE_INDEX, INDEX_URL, BASE).map((c) => c.url);

  assert.deepEqual(urls, [
    `${BASE}assets/Loader-C0Iq2ntQ.js`,
    `${BASE}assets/localization-C1ikogkU.js`,
  ]);
});

test("collecte le chunk d'une entrée rolldown (import() relatif, template literal)", () => {
  const urls = collectChunkRefs(ROLLDOWN_INDEX, INDEX_URL, BASE).map((c) => c.url);

  // C'est ce lien qui manquait en v950 : sans lui la traversée part d'une
  // frontière vide et aucun chunk n'est jamais atteint.
  assert.deepEqual(urls, [`${BASE}assets/bootstrap-DGbYLg0G.js`]);
});

test("les deux conventions cohabitent dans un même chunk, sans doublon", () => {
  const bootstrapUrl = `${BASE}assets/bootstrap-DGbYLg0G.js`;
  const urls = collectChunkRefs(ROLLDOWN_BOOTSTRAP, bootstrapUrl, BASE).map((c) => c.url);

  assert.deepEqual(urls, [
    `${BASE}assets/rolldown-runtime-CNC7AqOf.js`,
    `${BASE}assets/localization-C1ikogkU.js`,
    `${BASE}assets/Loader-C0Iq2ntQ.js`,
  ]);
});

test("les chemins relatifs sont résolus depuis le chunk courant, pas depuis la racine", () => {
  const nested = `${BASE}assets/nested/deep-Abc123.js`;
  const urls = collectChunkRefs("import(`./sibling-Xyz789.js`)", nested, BASE).map((c) => c.url);

  assert.deepEqual(urls, [`${BASE}assets/nested/sibling-Xyz789.js`]);
});

test("ignore le bruit qui n'est pas un chunk JS", () => {
  const source = "import(`./style-Abc.css`);fetch(`assets/atlas-Def.png`);const s=`assets/`;";

  assert.deepEqual(collectChunkRefs(source, INDEX_URL, BASE), []);
});

test("dédoublonne les références répétées", () => {
  const source = "import(`./Loader-C0Iq2ntQ.js`);import(`./Loader-C0Iq2ntQ.js`);";
  const urls = collectChunkRefs(source, INDEX_URL, BASE).map((c) => c.url);

  assert.equal(urls.length, 1);
});
