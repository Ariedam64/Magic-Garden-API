// src/core/game/bundle/extractor.js

import vm from "node:vm";

/**
 * Extrait un bloc équilibré de braces "{...}" en respectant les strings.
 */
export function extractBalancedBraces(text, startBraceIndex) {
  let depth = 0;
  let inStr = null;
  let esc = false;

  for (let i = startBraceIndex; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startBraceIndex, i + 1);
    }
  }

  throw new Error("Brace matching failed (object literal not fully extracted)");
}

/**
 * Extrait un bloc équilibré de parenthèses "(...)" en respectant les strings.
 */
export function extractBalancedParens(text, startParenIndex) {
  let depth = 0;
  let inStr = null;
  let esc = false;

  for (let i = startParenIndex; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }

    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(startParenIndex, i + 1);
    }
  }

  throw new Error("Paren matching failed");
}

/**
 * Parse le nom de variable avant "={".
 */
function parseVarNameBeforeEqBrace(mainJs, eqBraceIndex) {
  let j = eqBraceIndex - 1;
  while (j >= 0 && /[\s;]/.test(mainJs[j])) j--;
  let end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(mainJs[j])) j--;
  const name = mainJs.slice(j + 1, end);
  return name || null;
}

/**
 * Trouve un object literal dans le bundle par signatures.
 *
 * @param {string} mainJs - Contenu du bundle
 * @param {string[]} signatures - Signatures à chercher (anchor + confirms)
 * @param {number} windowSize - Taille de la fenêtre de recherche
 */
export function findObjectLiteralBySignatures(mainJs, signatures, windowSize = 120_000) {
  const [anchor, ...rest] = signatures;
  let from = 0;

  while (true) {
    const idx = mainJs.indexOf(anchor, from);
    if (idx === -1) return null;

    const start = Math.max(0, idx - windowSize);
    const end = Math.min(mainJs.length, idx + windowSize);
    const chunk = mainJs.slice(start, end);

    // Vérifie que toutes les signatures sont présentes
    const ok = rest.every((s) => chunk.includes(s));
    if (!ok) {
      from = idx + 1;
      continue;
    }

    // Trouve le début de l'objet (={)
    const eqBrace = mainJs.lastIndexOf("={", idx);
    if (eqBrace === -1) {
      from = idx + 1;
      continue;
    }

    const braceIndex = eqBrace + 1;
    const objLiteral = extractBalancedBraces(mainJs, braceIndex);
    const varName = parseVarNameBeforeEqBrace(mainJs, eqBrace);

    return { varName, objLiteral, anchorIndex: idx };
  }
}

/**
 * Exécute un object literal dans un sandbox.
 */
export function runObjectLiteral(objLiteral, sandbox, timeout = 2500) {
  return vm.runInNewContext(`(${objLiteral})`, sandbox, { timeout });
}

/**
 * Extrait une catégorie de données avec un sandbox personnalisé.
 */
export function extractCategoryWithSandbox(mainJs, name, signatures, buildSandbox) {
  const hit = findObjectLiteralBySignatures(mainJs, signatures);
  if (!hit) {
    throw new Error(`[${name}] not found (signatures not matched)`);
  }

  const sandbox = buildSandbox(mainJs, hit.objLiteral);
  const obj = runObjectLiteral(hit.objLiteral, sandbox);

  if (!obj || typeof obj !== "object") {
    throw new Error(`[${name}] extraction OK but invalid object`);
  }

  return { varName: hit.varName, data: obj };
}
