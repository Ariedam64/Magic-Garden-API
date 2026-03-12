// src/core/game/bundle/sandbox.js

import vm from "node:vm";
import { extractBalancedParens } from "./extractor.js";

/**
 * Crée un proxy enum qui retourne le nom de la propriété comme valeur.
 * Ex: proxy.Common => "Common"
 */
export function makeEnumProxy() {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (typeof prop === "symbol") return undefined;
        return String(prop);
      },
    }
  );
}

/**
 * Crée un proxy global pour le sandbox.
 * Tout identifiant inconnu retourne un enum proxy.
 */
export function makeGlobalSandboxProxy() {
  const base = {
    Date,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    JSON,
  };

  return new Proxy(base, {
    has: () => true,
    get: (t, prop) => {
      if (prop in t) return t[prop];
      const p = makeEnumProxy();
      t[prop] = p;
      return p;
    },
  });
}

// Cache pour éviter re-extraction des enums
const enumCache = new Map();

/**
 * Extrait une enum "string" du bundle.
 * Pattern: X=(t=>(t.Common="Common", ... , t))(X||{})
 */
export function tryExtractStringEnum(mainJs, enumId, requiredKeys = []) {
  const cacheKey = `str:${enumId}`;
  if (enumCache.has(cacheKey)) return enumCache.get(cacheKey);

  const needle = `${enumId}=(t=>`;
  let from = 0;

  while (true) {
    const pos = mainJs.indexOf(needle, from);
    if (pos === -1) {
      enumCache.set(cacheKey, null);
      return null;
    }

    const eq = mainJs.indexOf("=", pos);
    const par = mainJs.indexOf("(", eq + 1);
    if (par === -1) break;

    let expr;
    try {
      expr = extractBalancedParens(mainJs, par);
    } catch {
      from = pos + 1;
      continue;
    }

    const sandbox = makeGlobalSandboxProxy();
    sandbox[enumId] = {};

    let obj;
    try {
      obj = vm.runInNewContext(expr, sandbox, { timeout: 1000 });
    } catch {
      from = pos + 1;
      continue;
    }

    if (!obj || typeof obj !== "object") {
      from = pos + 1;
      continue;
    }

    if (requiredKeys.length && !requiredKeys.every((k) => k in obj)) {
      from = pos + 1;
      continue;
    }

    enumCache.set(cacheKey, obj);
    return obj;
  }

  enumCache.set(cacheKey, null);
  return null;
}

/**
 * Vide les caches d'enums.
 */
export function clearEnumCaches() {
  enumCache.clear();
}
