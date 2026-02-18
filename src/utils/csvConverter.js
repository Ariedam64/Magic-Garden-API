// src/utils/csvConverter.js

/**
 * Converts JSON data (keyed objects) to CSV format.
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
 * Escape a CSV field value.
 * Wraps in quotes if it contains commas, quotes, or newlines.
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert a keyed object (e.g. { Carrot: {...}, Tomato: {...} }) to CSV.
 * Each top-level key becomes a row, with an "id" column prepended.
 *
 * @param {Object} data - Object with string keys and object values
 * @param {Object} options
 * @param {string} [options.idColumn="id"] - Name of the ID column
 * @returns {string} CSV string
 */
export function jsonToCsv(data, { idColumn = "id" } = {}) {
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

  // Build CSV
  const lines = [];

  // Header
  lines.push(columns.map(escapeCsvField).join(","));

  // Rows
  for (const row of flatRows) {
    const values = columns.map((col) => {
      const val = col === idColumn ? row.id : row[col];
      return escapeCsvField(val);
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * Convert a "combined" data response (e.g. { plants: {...}, pets: {...} })
 * into CSV. Each category's items are flattened with a "category" column.
 *
 * @param {Object} data - Object with category keys containing keyed objects
 * @returns {string} CSV string
 */
export function combinedJsonToCsv(data) {
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

  // Build CSV
  const lines = [];
  lines.push(columns.map(escapeCsvField).join(","));

  for (const row of allRows) {
    const values = columns.map((col) => escapeCsvField(row[col]));
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * Send a CSV response with appropriate headers.
 *
 * @param {import("express").Response} res
 * @param {string} csv - CSV content
 * @param {string} filename - Suggested download filename
 */
export function sendCsv(res, csv, filename) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}
