import { createHash } from "node:crypto";

export function buildWeakEtag(...parts) {
  const raw = parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join("|");

  if (!raw) return null;

  const hash = createHash("sha1").update(raw).digest("hex");
  return `W/"${hash}"`;
}

export function isFresh(req, etag) {
  if (!etag) return false;

  const header = req.headers["if-none-match"];
  if (!header) return false;

  if (header === "*") return true;

  const tags = header.split(",").map((tag) => tag.trim());
  return tags.includes(etag);
}

export function applyCacheHeaders(res, { etag, cacheControl } = {}) {
  if (etag) res.setHeader("ETag", etag);
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
}
