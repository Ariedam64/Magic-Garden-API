// src/utils/csvConverter.js

/**
 * Converts JSON data (keyed objects) to delimited text formats (CSV, TSV).
 * Handles nested objects by flattening keys with dot notation.
 */

/**
 * Flatten a nested object into dot-notation keys.
 * Arrays are JSON-stringified.
 */
function flattenObject(obj, prefix = "") {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      result[fullKey] = JSON.stringify(value);
    } else if (value !== null && typeof value === "object") {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Escape a field value for delimited output.
 * Wraps in quotes if it contains the delimiter, quotes, or newlines.
 */
function escapeField(value, delimiter) {
  if (value === null || value === undefined) return "";

  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert a keyed object (e.g. { Carrot: {...}, Tomato: {...} }) to delimited text.
 * Each top-level key becomes a row, with an "id" column prepended.
 *
 * @param {Object} data - Object with string keys and object values
 * @param {Object} options
 * @param {string} [options.idColumn="id"] - Name of the ID column
 * @param {string} [options.delimiter=","] - Field delimiter
 * @returns {string} Delimited string
 */
function jsonToDelimited(data, { idColumn = "id", delimiter = "," } = {}) {
  if (!data || typeof data !== "object") return "";

  const entries = Object.entries(data);
  if (entries.length === 0) return "";

  // Flatten all rows to collect all possible columns
  const flatRows = entries.map(([key, value]) => {
    const flat = typeof value === "object" && value !== null
      ? flattenObject(value)
      : { value };
    return { id: key, ...flat };
  });

  // Collect all unique columns, preserving insertion order
  const columnSet = new Set();
  columnSet.add(idColumn);
  for (const row of flatRows) {
    for (const key of Object.keys(row)) {
      if (key === "id") {
        columnSet.add(idColumn);
      } else {
        columnSet.add(key);
      }
    }
  }
  const columns = [...columnSet];

  // Build output
  const lines = [];

  // Header
  lines.push(columns.map((c) => escapeField(c, delimiter)).join(delimiter));

  // Rows
  for (const row of flatRows) {
    const values = columns.map((col) => {
      const val = col === idColumn ? row.id : row[col];
      return escapeField(val, delimiter);
    });
    lines.push(values.join(delimiter));
  }

  return lines.join("\n");
}

/**
 * Convert a "combined" data response (e.g. { plants: {...}, pets: {...} })
 * into delimited text. Each category's items are flattened with a "category" column.
 *
 * @param {Object} data - Object with category keys containing keyed objects
 * @param {Object} options
 * @param {string} [options.delimiter=","] - Field delimiter
 * @returns {string} Delimited string
 */
function combinedJsonToDelimited(data, { delimiter = "," } = {}) {
  if (!data || typeof data !== "object") return "";

  const allRows = [];

  for (const [category, items] of Object.entries(data)) {
    if (!items || typeof items !== "object") continue;

    for (const [key, value] of Object.entries(items)) {
      const flat = typeof value === "object" && value !== null
        ? flattenObject(value)
        : { value };
      allRows.push({ category, id: key, ...flat });
    }
  }

  if (allRows.length === 0) return "";

  // Collect all unique columns
  const columnSet = new Set(["category", "id"]);
  for (const row of allRows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }
  const columns = [...columnSet];

  // Build output
  const lines = [];
  lines.push(columns.map((c) => escapeField(c, delimiter)).join(delimiter));

  for (const row of allRows) {
    const values = columns.map((col) => escapeField(row[col], delimiter));
    lines.push(values.join(delimiter));
  }

  return lines.join("\n");
}

// =====================
// CSV exports (comma-separated)
// =====================

export function jsonToCsv(data, options = {}) {
  return jsonToDelimited(data, { ...options, delimiter: "," });
}

export function combinedJsonToCsv(data) {
  return combinedJsonToDelimited(data, { delimiter: "," });
}

export function sendCsv(res, content, filename) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(content);
}

// =====================
// TSV exports (tab-separated)
// =====================

export function jsonToTsv(data, options = {}) {
  return jsonToDelimited(data, { ...options, delimiter: "\t" });
}

export function combinedJsonToTsv(data) {
  return combinedJsonToDelimited(data, { delimiter: "\t" });
}

export function sendTsv(res, content, filename) {
  res.setHeader("Content-Type", "text/tab-separated-values; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(content);
}
