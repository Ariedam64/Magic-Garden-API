// src/core/game/bundle/colors.js
//
// Extraction des couleurs UI (abilities, mutations) depuis le bundle du jeu.
//
// Ce code a cassé à chaque refonte du build du jeu parce qu'il était couplé à
// la *syntaxe exacte* du bundle minifié. Formes déjà rencontrées :
//
//   switch(e){case`GoldGranter`:return`#DCC846`}          -> string
//   Nm={Gold:`rgb(235, 200, 0)`,...}                      -> map de strings
//   switch(e){case`MoonKisser`:return{solid:`#FAA623`}}   -> objet {solid,gradient}
//   Nm={Gold:{solid:`rgb(235, 200, 0)`},...}              -> map d'objets
//   case`GoldGranter`:return Fm                           -> const hoistée
//
// Plutôt que de courir après chaque nouvelle forme, on parse de façon tolérante :
//
//  1. on localise le bloc par les *noms de domaine* (`Gold`, `MoonKisser`, ...),
//     jamais par un nom de variable minifié ni par la syntaxe de la valeur ;
//  2. on accepte les deux conteneurs possibles (switch statement ET object
//     literal), quel que soit le type de quote utilisé par le minifieur ;
//  3. on normalise n'importe quelle valeur : string, objet ({solid}/{color}),
//     identifiant hoisté (résolu dans les sources), et en dernier recours le
//     premier littéral de couleur trouvé dans l'expression.
//
// Conséquence : un retour à l'ancienne forme, un passage à `{ hex: ... }`, un
// changement de quotes ou un déplacement dans un autre chunk sont absorbés
// sans modification de code.

import { logger } from "../../../logger/index.js";

/** Littéral de couleur CSS : #rgb(a), #rrggbb(aa), rgb()/rgba()/hsl()/hsla(). */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/;
const COLOR_LITERAL_G = new RegExp(COLOR_LITERAL.source, "g");
const COLOR_ONLY = new RegExp(`^(?:${COLOR_LITERAL.source})$`);

/** Clés susceptibles de porter la couleur "plate" dans un objet de couleur. */
const SOLID_KEYS = ["solid", "color", "hex", "base", "value"];

/** Profondeur max de résolution (objet -> identifiant -> objet -> ...). */
const MAX_RESOLVE_DEPTH = 5;

/** Une valeur de couleur crédible reste courte ; au-delà on est dans un objet de données. */
const MAX_VALUE_LENGTH = 2000;

const OPENERS = { "{": "}", "[": "]", "(": ")" };
const CLOSERS = new Set(["}", "]", ")"]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isColorLiteral(str) {
  return typeof str === "string" && COLOR_ONLY.test(str.trim());
}

function firstColorLiteral(text) {
  COLOR_LITERAL_G.lastIndex = 0;
  return COLOR_LITERAL_G.exec(text)?.[0] ?? null;
}

function countColorLiterals(text) {
  COLOR_LITERAL_G.lastIndex = 0;
  let n = 0;
  while (COLOR_LITERAL_G.exec(text)) n++;
  return n;
}

/**
 * Lit une expression JS à partir de `start`, en s'arrêtant sur la virgule ou le
 * point-virgule de plus haut niveau (ou sur la fermeture du conteneur parent).
 * Conteneurs et strings sont respectés.
 *
 * @returns {{ text: string, end: number }}
 */
export function readExpression(source, start) {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) i++;

  const begin = i;
  const stack = [];
  let inStr = null;
  let esc = false;

  for (; i < source.length; i++) {
    const ch = source[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }

    if (OPENERS[ch]) {
      stack.push(OPENERS[ch]);
      continue;
    }

    if (CLOSERS.has(ch)) {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
        continue;
      }
      break; // fermeture du conteneur parent
    }

    if (!stack.length && (ch === "," || ch === ";")) break;
  }

  return { text: source.slice(begin, i).trim(), end: i };
}

/**
 * Lit un littéral de string (quelle que soit la quote) à partir de `start`.
 * @returns {{ value: string, end: number } | null}
 */
function readStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;

  let esc = false;
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === quote) return { value: source.slice(start + 1, i), end: i + 1 };
  }

  return null;
}

/**
 * Parse les paires `clé: valeur` de premier niveau d'un object literal.
 * Les valeurs sont rendues telles quelles (texte brut de l'expression).
 *
 * @param {string} objText - texte commençant par `{`
 * @returns {[string, string][]}
 */
export function parseObjectEntries(objText) {
  const entries = [];
  const openIndex = objText.indexOf("{");
  if (openIndex === -1) return entries;

  let i = openIndex + 1;

  while (i < objText.length) {
    while (i < objText.length && /[\s,;]/.test(objText[i])) i++;
    if (i >= objText.length || objText[i] === "}") break;

    const start = i;
    let key = null;

    const str = readStringLiteral(objText, i);
    if (str) {
      key = str.value;
      i = str.end;
    } else {
      let j = i;
      while (j < objText.length && /[A-Za-z0-9_$]/.test(objText[j])) j++;
      if (j > i) {
        key = objText.slice(i, j);
        i = j;
      }
    }

    // Clé exotique (computed, spread, méthode...) : on saute la valeur.
    if (key === null) {
      const { end } = readExpression(objText, i);
      i = end > start ? end : start + 1;
      continue;
    }

    while (i < objText.length && /\s/.test(objText[i])) i++;

    // Shorthand (`{a,b}`) : pas de valeur exploitable.
    if (objText[i] !== ":") {
      const { end } = readExpression(objText, i);
      i = end > start ? end : start + 1;
      continue;
    }

    const { text, end } = readExpression(objText, i + 1);
    entries.push([key, text]);
    i = end > i ? end : i + 1;
  }

  return entries;
}

/**
 * Résout l'expression d'une valeur de couleur vers `{ solid, gradient }`.
 *
 * Accepte : string literal, object literal ({solid}/{color}/{hex}/...),
 * identifiant hoisté (recherché dans `sources`), ou n'importe quelle
 * expression contenant un littéral de couleur.
 *
 * @returns {{ solid: string, gradient: string | null } | null}
 */
export function resolveColorValue(expr, sources = [], depth = 0) {
  if (!expr || depth > MAX_RESOLVE_DEPTH) return null;

  const text = expr.trim();
  if (!text || text.length > MAX_VALUE_LENGTH) return null;

  // 1. String literal direct : `#FAA623` / `rgb(255, 180, 120)`
  const str = readStringLiteral(text, 0);
  if (str && str.end === text.length) {
    return isColorLiteral(str.value) ? { solid: str.value.trim(), gradient: null } : null;
  }

  // 2. Object literal : on privilégie la clé "plate", sinon on prend le
  //    premier littéral de couleur (couvre une future clé inconnue).
  if (text.startsWith("{")) {
    const entries = parseObjectEntries(text);
    const gradient = entries.find(([k]) => k.toLowerCase() === "gradient")?.[1] ?? null;

    for (const key of SOLID_KEYS) {
      const hit = entries.find(([k]) => k.toLowerCase() === key);
      if (!hit) continue;
      const resolved = resolveColorValue(hit[1], sources, depth + 1);
      if (resolved) return { solid: resolved.solid, gradient: gradient ?? resolved.gradient };
    }

    const fallback = firstColorLiteral(text);
    return fallback ? { solid: fallback, gradient } : null;
  }

  // 3. Identifiant hoisté : `case`GoldGranter`:return Fm`
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    for (const source of sources) {
      const resolved = resolveIdentifier(source, text, sources, depth);
      if (resolved) return resolved;
    }
    return null;
  }

  // 4. Dernier recours : n'importe quelle couleur dans l'expression.
  const fallback = firstColorLiteral(text);
  return fallback ? { solid: fallback, gradient: null } : null;
}

/**
 * Cherche `<name> = <expression>` dans une source et résout la valeur.
 * Plusieurs assignations peuvent exister (minification) : on garde la première
 * qui donne une couleur.
 */
function resolveIdentifier(source, name, sources, depth) {
  if (!source) return null;

  const re = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(name)}\\s*=\\s*`, "g");
  let m;

  while ((m = re.exec(source))) {
    const { text, end } = readExpression(source, m.index + m[0].length);
    re.lastIndex = Math.max(re.lastIndex, end);
    if (text === name) continue; // auto-référence
    const resolved = resolveColorValue(text, sources, depth + 1);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Compte les noms connus présents dans une source (simple présence textuelle).
 * Sert de pré-filtre bon marché avant les recherches structurelles.
 */
export function countKnownNames(source, names) {
  if (!source) return 0;
  return names.reduce((n, name) => n + (source.includes(name) ? 1 : 0), 0);
}

// --- Forme 1 : switch statement -------------------------------------------

const CASE_LABEL = /case\s*(['"`])([A-Za-z0-9_$]+)\1\s*:/g;

/**
 * Trouve le corps du switch dont les `case` couvrent au moins `minHits` noms
 * connus. Insensible au nom de la variable testée et au type de quote.
 */
function findColorSwitchBody(source, names, minHits) {
  const known = new Set(names);
  const switchRe = /\bswitch\s*\(/g;
  let m;

  while ((m = switchRe.exec(source))) {
    const braceStart = source.indexOf("{", m.index);
    if (braceStart === -1) return null;

    let depth = 0;
    let end = braceStart;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }

    const body = source.slice(braceStart + 1, end);

    CASE_LABEL.lastIndex = 0;
    const labels = new Set();
    let label;
    while ((label = CASE_LABEL.exec(body))) {
      if (known.has(label[2])) labels.add(label[2]);
    }

    if (labels.size >= minHits) return body;

    switchRe.lastIndex = braceStart + 1;
  }

  return null;
}

/**
 * Parse `case`X`: case`Y`: return <valeur>` (cas groupés inclus) et `default:`.
 */
function parseSwitchColors(body, sources) {
  const colors = {};
  let defaultColor = null;

  const tokenRe = /case\s*(['"`])([A-Za-z0-9_$]+)\1\s*:|\bdefault\s*:|\breturn\b/g;
  let pending = [];
  let hasDefault = false;
  let m;

  while ((m = tokenRe.exec(body))) {
    if (m[2] !== undefined) {
      pending.push(m[2]);
      continue;
    }

    if (m[0].startsWith("default")) {
      hasDefault = true;
      continue;
    }

    const { text, end } = readExpression(body, m.index + m[0].length);
    tokenRe.lastIndex = Math.max(tokenRe.lastIndex, end);

    const resolved = resolveColorValue(text, sources);
    if (resolved) {
      for (const name of pending) colors[name] = resolved;
      if (hasDefault && !pending.length) defaultColor = resolved;
    }

    pending = [];
    hasDefault = false;
  }

  return { colors, defaultColor };
}

// --- Forme 2 : object literal ---------------------------------------------

/**
 * Remonte jusqu'à l'object literal qui *contient* `anchorIndex` et dont les
 * clés couvrent au moins `minHits` noms connus.
 *
 * On ne peut pas scanner en arrière en tenant compte des strings (le chunk de
 * localisation contient des `{` dans des messages i18n), donc on valide chaque
 * candidat en le ré-extrayant vers l'avant : si l'extraction équilibrée ne
 * recouvre pas l'ancre, c'est qu'on était dans une string -> on continue.
 */
function findEnclosingColorMap(source, anchorIndex, names, minHits) {
  const known = new Set(names);
  const min = Math.max(0, anchorIndex - 200_000);
  let depth = 0;
  let attempts = 0;

  for (let i = anchorIndex; i >= min && attempts < 40; i--) {
    const ch = source[i];
    if (ch === "}") {
      depth++;
      continue;
    }
    if (ch !== "{") continue;
    if (depth > 0) {
      depth--;
      continue;
    }

    attempts++;
    const objText = extractBalanced(source, i);
    if (!objText || i + objText.length <= anchorIndex) continue; // string mal alignée

    const entries = parseObjectEntries(objText);
    const hits = entries.filter(([k]) => known.has(k)).length;
    if (hits >= minHits) return entries;
  }

  return null;
}

/** Extraction équilibrée `{...}` en respectant les strings. */
function extractBalanced(source, start) {
  let depth = 0;
  let inStr = null;
  let esc = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }

  return null;
}

/**
 * Trouve la map `Nom: couleur` en s'ancrant sur un nom connu dont la valeur
 * ressemble à une couleur, puis en remontant à l'objet englobant.
 */
function findColorMapEntries(source, names, minHits, sources) {
  for (const name of names) {
    const anchorRe = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(name)}\\s*:`, "g");
    let m;

    while ((m = anchorRe.exec(source))) {
      const anchor = m.index + m[0].length - name.length - 1;
      const { text } = readExpression(source, m.index + m[0].length);
      if (!resolveColorValue(text, sources)) continue;

      const entries = findEnclosingColorMap(source, anchor, names, minHits);
      if (entries) return entries;
    }
  }

  return null;
}

// --- API publique ----------------------------------------------------------

/**
 * Extrait la map `nom -> couleur` depuis les sources fournies.
 *
 * Essaie chaque source dans l'ordre, avec les deux conteneurs possibles
 * (switch puis object literal). La première qui donne assez de noms connus
 * gagne. Les identifiants hoistés sont résolus dans *toutes* les sources.
 *
 * @param {(string|null|undefined)[]} sources
 * @param {{ names: string[], minHits?: number, label?: string }} options
 * @returns {{ colors: Record<string, {solid: string, gradient: string|null}>, defaultColor: object|null }}
 */
export function extractColorMapping(sources, { names, minHits = 3, label = "colors" }) {
  const candidates = sources.filter(Boolean);

  for (const source of candidates) {
    if (countKnownNames(source, names) < minHits) continue;

    const switchBody = findColorSwitchBody(source, names, minHits);
    if (switchBody) {
      const { colors, defaultColor } = parseSwitchColors(switchBody, candidates);
      if (Object.keys(colors).length) {
        logger.debug({ label, form: "switch", count: Object.keys(colors).length }, "Color mapping extracted");
        return { colors, defaultColor };
      }
    }

    const entries = findColorMapEntries(source, names, minHits, candidates);
    if (entries) {
      const colors = {};
      for (const [key, expr] of entries) {
        const resolved = resolveColorValue(expr, candidates);
        if (resolved) colors[key] = resolved;
      }
      if (Object.keys(colors).length) {
        logger.debug({ label, form: "map", count: Object.keys(colors).length }, "Color mapping extracted");
        return { colors, defaultColor: null };
      }
    }
  }

  logger.error({ label, sources: candidates.length }, "Color mapping not found in bundle (falling back to default color)");
  return { colors: {}, defaultColor: null };
}

/**
 * Prédicat utilisé par le résolveur de chunks : cette source définit-elle bien
 * les couleurs de `names` ? On exige des couleurs réellement extractibles, pas
 * juste la présence des noms (le chunk de données contient les mêmes noms).
 */
export function definesColorsFor(source, names, minHits = 3) {
  if (countKnownNames(source, names) < minHits) return false;
  if (countColorLiterals(source) < minHits) return false;

  if (findColorSwitchBody(source, names, minHits)) return true;
  return Boolean(findColorMapEntries(source, names, minHits, [source]));
}

/**
 * Couverture de la dernière extraction, par catégorie. Exposée sur /health :
 * la prochaine casse se voit dans le monitoring au lieu de passer par un
 * signalement d'utilisateur.
 */
const coverage = new Map();

export function getColorCoverage() {
  return Object.fromEntries(coverage);
}

/**
 * Applique une map de couleurs à une collection d'entités et journalise la
 * couverture — c'est ce log qui rend la prochaine casse visible immédiatement.
 */
export function applyColors(entities, colors, defaultColor, label) {
  const total = Object.keys(entities).length;
  let matched = 0;

  for (const [key, entity] of Object.entries(entities)) {
    const hit = colors[key];
    if (hit) matched++;
    entity.color = hit?.solid ?? defaultColor;
  }

  // Une couverture partielle est normale : certaines entités n'ont volontairement
  // pas de case dans le bundle et tombent sur la couleur par défaut du jeu. On
  // n'alerte donc que sur un effondrement de la couverture, signe que le bloc a
  // bougé ou changé de forme.
  if (total && !matched) {
    logger.error({ label, total }, "No color matched: bundle color block moved or changed shape");
  } else if (total && matched < total / 2) {
    logger.warn({ label, matched, total }, "Color coverage dropped: bundle color block may have changed");
  } else {
    logger.debug({ label, matched, total }, "Colors applied");
  }

  coverage.set(label, { matched, total, extractedAt: new Date().toISOString() });

  return entities;
}
