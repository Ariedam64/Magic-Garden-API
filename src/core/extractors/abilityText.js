// src/core/extractors/abilityText.js
//
// Extraction des descriptions d'abilities.
//
// Les descriptions ne vivent pas dans le chunk de données mais dans le chunk UI,
// sous la forme d'un gros `switch(abilityId)` qui construit les tooltips :
//
//   case`DoubleHarvest`: return HG({id:`Wg0Nq6`, message:`Chance to harvest an extra crop`});
//   case`MoonKisser`:    return Z({id:`8BUN7/`, message:`Chance to replace <0/> with <1/> ...`},
//                                 {0: zG(`Ambershine`), 1: zG(`Ambercharged`)});
//
// Les noms des helpers (`Z`, `HG`, `zG`, ...) sont minifiés et changent à chaque
// build : rien n'est reconnu par son nom. La stratégie est d'évaluer le switch
// dans un sandbox où tout identifiant inconnu devient un proxy enregistreur, ce
// qui transforme chaque `case` en arbre d'appels que l'on interprète ensuite.

import vm from "node:vm";

import { extractBalanced } from "../game/bundle/extractor.js";
import { makeGlobalSandboxProxy } from "../game/bundle/sandbox.js";
import { ABILITY_COLOR_NAMES, COLOR_MIN_HITS } from "../game/bundle/colorNames.js";
import { extractEnums, findStringEnumMap } from "./enums.js";
import { logger } from "../../logger/index.js";

// Mêmes identifiants stables que pour les couleurs : ils survivent à la
// minification, contrairement aux noms de variables. Voir `colorNames.js`.
const SWITCH_SIGNATURES = ABILITY_COLOR_NAMES;
const MIN_SIGNATURE_HITS = COLOR_MIN_HITS;

const VM_TIMEOUT_MS = 3000;
const MAX_RESOLVE_DEPTH = 8;
const MAX_INLINE_STEPS = 3;

// Clés utilisées pour identifier l'enum Rarity dans le chunk de données.
const RARITY_ENUM_KEYS = ["Common", "Uncommon", "Rare"];

/**
 * Proxy enregistreur : mémorise le chemin d'accès traversé et transforme tout
 * appel en noeud `{ __call, args }`.
 */
function makeRecorder(path) {
  const target = () => {};

  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === "__path") return path;
      // `toJSON` doit rester absent pour ne pas parasiter la sérialisation.
      if (typeof prop === "symbol" || prop === "toJSON") return undefined;
      return makeRecorder(`${path}.${String(prop)}`);
    },
    apply: (_t, _self, args) => ({ __call: path, args }),
  });
}

function makeRecordingSandbox() {
  const base = { Math, Number, String, Object, Array, JSON };

  return new Proxy(base, {
    has: () => true,
    get: (target, prop) => {
      if (prop in target) return target[prop];
      const recorder = makeRecorder(String(prop));
      target[prop] = recorder;
      return recorder;
    },
  });
}

const isRecorder = (value) => typeof value === "function" && typeof value.__path === "string";
const isCallNode = (value) =>
  !!value && typeof value === "object" && typeof value.__call === "string";

const countKnownNames = (source) =>
  SWITCH_SIGNATURES.filter((name) => source.includes(`\`${name}\``)).length;

/**
 * Localise le switch des descriptions : le seul qui combine des noms
 * d'abilities connus et des messages i18n.
 *
 * Le filtre bon marché en tête évite de dérouler les blocs équilibrés de chaque
 * `switch` du bundle : le résolveur appelle ce test sur chaque chunk traversé.
 */
export function findDescriptionSwitch(uiJs) {
  if (!uiJs.includes("message:") || countKnownNames(uiJs) < MIN_SIGNATURE_HITS) return null;

  const switchRegex = /\bswitch\s*\(\s*([A-Za-z0-9_$]+)\s*\)\s*\{/g;
  let match;

  while ((match = switchRegex.exec(uiJs))) {
    const braceIndex = match.index + match[0].length - 1;
    const block = extractBalanced(uiJs, braceIndex, "{", "}");
    if (!block) continue;

    const body = block.slice(1, -1);
    if (!body.includes("message:")) continue;

    if (countKnownNames(body) >= MIN_SIGNATURE_HITS) return { param: match[1], body };
  }

  return null;
}

/**
 * Un chunk porte-t-il les descriptions d'abilities ?
 *
 * Comme pour les couleurs, le test n'est pas une signature textuelle mais la
 * localisation réelle du bloc : c'est ce qui rend la détection insensible aux
 * changements de découpage et de syntaxe du bundle.
 */
export function definesAbilityDescriptions(source) {
  return findDescriptionSwitch(source) !== null;
}

function findFunctionSource(js, name) {
  const at = js.indexOf(`function ${name}(`);
  if (at === -1) return null;

  const braceIndex = js.indexOf("{", at);
  if (braceIndex === -1) return null;

  const block = extractBalanced(js, braceIndex, "{", "}");
  return block === null ? null : js.slice(at, braceIndex) + block;
}

function findObjectConstSource(js, name) {
  const escaped = name.replace(/[$]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^A-Za-z0-9_$.])${escaped}=\\{`, "g");
  let match;

  while ((match = regex.exec(js))) {
    const braceIndex = js.indexOf("{", match.index);
    const block = extractBalanced(js, braceIndex, "{", "}");
    if (block !== null) return block;
  }

  return null;
}

/**
 * Résout un tableau de données du chunk data à partir de sa clé.
 * Sert aux tables indexées référencées par le chunk UI (ex. les raretés de
 * chaque palier de SeedFinder : `SeedFinderI:[F.Common,F.Uncommon]`).
 */
function resolveDataArray(ctx, key) {
  const match = new RegExp(`[,{]${key}:\\[`).exec(ctx.dataJs);
  if (!match) return null;

  const bracketIndex = ctx.dataJs.indexOf("[", match.index);
  const literal = extractBalanced(ctx.dataJs, bracketIndex, "[", "]");
  if (literal === null) return null;

  const sandbox = makeGlobalSandboxProxy();

  // Les entrées sont des membres d'enum (`F.Common`). On injecte l'enum réel
  // pour obtenir les valeurs canoniques (Mythic -> "Mythical") plutôt que le
  // nom de clé, cohérent avec le reste de l'API.
  const enumId = literal.match(/\[([A-Za-z_$][\w$]*)\./)?.[1];
  if (enumId && ctx.rarityMap) sandbox[enumId] = ctx.rarityMap;

  try {
    return vm.runInNewContext(literal, sandbox, { timeout: VM_TIMEOUT_MS });
  } catch {
    return null;
  }
}

/**
 * Remplace récursivement les proxies enregistreurs par des valeurs concrètes
 * quand le bundle permet de les résoudre.
 */
function resolveNode(node, ctx, depth = 0) {
  if (depth > MAX_RESOLVE_DEPTH) return node;

  if (isRecorder(node)) {
    const path = node.__path;

    const constSource = findObjectConstSource(ctx.uiJs, path);
    if (constSource) {
      try {
        const value = vm.runInNewContext(`(${constSource})`, makeRecordingSandbox(), {
          timeout: VM_TIMEOUT_MS,
        });
        return resolveNode(value, ctx, depth + 1);
      } catch {
        /* on retombe sur le chemin brut */
      }
    }

    // `Table.Key.0` -> tableau indexé du chunk data
    const segments = path.split(".");
    if (segments.length >= 3 && /^\d+$/.test(segments.at(-1))) {
      const values = resolveDataArray(ctx, segments.at(-2));
      const value = values?.[Number(segments.at(-1))];
      if (typeof value === "string") return value;
    }

    return { __ident: path };
  }

  if (isCallNode(node)) {
    // Les jetons passent par des helpers (`zG(\`Ambershine\`)`, `vw($u.Coins)`,
    // ...) qu'il faut inliner pour retrouver la forme structurée du tag.
    //
    // Les arguments sont résolus d'abord : un helper qui indexe un objet avec
    // son argument (`Ow(iw[e], Md[e], t)`) échoue tant que `e` est resté un
    // proxy, un proxy n'étant pas convertible en clé de propriété.
    const args = node.args.map((arg) => resolveNode(arg, ctx, depth + 1));

    const inlined = inlineHelper({ __call: node.__call, args }, ctx.uiJs);
    if (inlined && typeof inlined === "object") {
      return resolveNode(inlined, ctx, depth + 1);
    }

    return { __call: node.__call, args };
  }

  if (Array.isArray(node)) return node.map((item) => resolveNode(item, ctx, depth + 1));

  if (node && typeof node === "object") {
    const copy = {};
    for (const [key, value] of Object.entries(node)) {
      copy[key] = resolveNode(value, ctx, depth + 1);
    }
    return copy;
  }

  return node;
}

const findDescriptor = (node) =>
  isCallNode(node)
    ? node.args.find((arg) => arg && typeof arg === "object" && typeof arg.message === "string")
    : undefined;

/**
 * Certains `case` délèguent à un helper qui construit lui-même le message
 * (ex. `GG(\`Gold\`)` -> `Z(obe, {0: zG(\`Gold\`)})`). On inline ces helpers
 * tant qu'aucun message n'est visible.
 */
function inlineHelper(node, uiJs) {
  const source = findFunctionSource(uiJs, node.__call);
  if (!source) return null;

  try {
    const anonymized = source.replace(/^function\s+[A-Za-z0-9_$]+/, "function");
    const fn = vm.runInNewContext(`(${anonymized})`, makeRecordingSandbox(), {
      timeout: VM_TIMEOUT_MS,
    });
    return fn(...node.args);
  } catch {
    return null;
  }
}

/**
 * Valeur d'un jeton : soit un littéral, soit un membre d'enum non résolu dont
 * seul le chemin subsiste (`$u.Coins` -> "Coins").
 */
function identOf(value) {
  if (typeof value === "string") return value || null;
  if (typeof value?.__ident === "string") return value.__ident.split(".").at(-1) || null;
  return null;
}

/**
 * Classe un jeton de description.
 *
 * Les formes viennent du système de tags du jeu et portent leur propre
 * sémantique : `{mutation}`, `{currency}`, `{gameThing}`. `gameThing` couvre
 * trois cas, départagés par l'identifiant : une rareté (SeedFinder), une
 * culture (chemin `...<Species>.crop.sprite`) ou un item.
 */
function classifyToken(node, ctx) {
  const mutation = identOf(node?.mutation);
  if (mutation) return { type: "mutation", id: mutation };

  const currency = identOf(node?.currency?.currency);
  if (currency) return { type: "currency", id: currency };

  const spritePath = node?.gameThing?.sprite?.__ident;
  if (typeof spritePath === "string") {
    const segments = spritePath.split(".");
    const id = segments[1] ?? null;

    if (id && ctx.rarityValues.has(id)) return { type: "rarity", id };
    return { type: segments.includes("crop") ? "crop" : "item", id };
  }

  return { type: "unknown", id: null };
}

/**
 * Convertit l'objet de tags `{0: ..., 1: ...}` en tableau positionnel aligné
 * sur les placeholders `<0/>`, `<1/>` du message.
 */
function buildTokens(tagsArg, ctx) {
  if (!tagsArg) return [];

  const indexes = Object.keys(tagsArg)
    .map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0);
  if (indexes.length === 0) return [];

  const tokens = new Array(Math.max(...indexes) + 1).fill(null);
  for (const index of indexes) {
    tokens[index] = classifyToken(resolveNode(tagsArg[index], ctx), ctx);
  }

  return tokens.map((token) => token ?? { type: "unknown", id: null });
}

const isTagsObject = (arg) =>
  !!arg &&
  typeof arg === "object" &&
  !Array.isArray(arg) &&
  typeof arg.message !== "string" &&
  Object.keys(arg).every((key) => /^\d+$/.test(key));

/**
 * Extrait `{ [abilityId]: { description, descriptionTokens } }` depuis le chunk UI.
 * Retourne {} si le switch est introuvable — l'absence de descriptions ne doit
 * pas casser l'extraction des abilities.
 */
export function extractAbilityDescriptions(uiJs, dataJs) {
  if (!uiJs) return {};

  const found = findDescriptionSwitch(uiJs);
  if (!found) {
    logger.warn("Ability description switch not found in bundle");
    return {};
  }

  let selectDescription;
  try {
    selectDescription = vm.runInNewContext(
      `(${found.param}=>{switch(${found.param}){${found.body}}})`,
      makeRecordingSandbox(),
      { timeout: VM_TIMEOUT_MS }
    );
  } catch (err) {
    logger.warn({ err: err.message }, "Ability description switch not evaluable");
    return {};
  }

  const names = [
    ...new Set([...found.body.matchAll(/case`([A-Za-z0-9_]+)`/g)].map((match) => match[1])),
  ];

  // L'enum Rarity sert à la fois à résoudre les tables indexées du chunk data
  // et à reconnaître les jetons de rareté, qui partagent la forme `gameThing`
  // avec les items et les cultures.
  const ctx = {
    uiJs,
    dataJs,
    rarityMap: findStringEnumMap(dataJs, RARITY_ENUM_KEYS),
    rarityValues: new Set(extractEnums(dataJs).rarity ?? []),
  };

  const descriptions = {};
  const missing = [];

  for (const name of names) {
    let node;
    try {
      node = selectDescription(name);
    } catch {
      missing.push(name);
      continue;
    }

    // Le message est soit inline dans les arguments, soit derrière une
    // constante partagée (résolue en résolvant les arguments), soit derrière un
    // helper qui le construit lui-même (résolu en l'inlinant).
    for (let step = 0; step < MAX_INLINE_STEPS && isCallNode(node); step++) {
      node = {
        __call: node.__call,
        args: node.args.map((arg) => resolveNode(arg, ctx)),
      };
      if (findDescriptor(node)) break;

      const inlined = inlineHelper(node, uiJs);
      if (!isCallNode(inlined)) break;
      node = inlined;
    }

    const descriptor = findDescriptor(node);
    if (!descriptor) {
      missing.push(name);
      continue;
    }

    descriptions[name] = {
      description: descriptor.message,
      descriptionTokens: buildTokens(node.args.find(isTagsObject), ctx),
    };
  }

  if (missing.length) {
    logger.warn({ abilities: missing }, "Ability descriptions not resolved");
  }

  logger.debug({ count: Object.keys(descriptions).length }, "Ability descriptions extracted");
  return descriptions;
}
