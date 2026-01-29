// src/api/routes/docs.js

import express from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load OpenAPI spec
const openapiPath = join(__dirname, "..", "..", "docs", "openapi.yaml");
const swaggerDocument = YAML.load(openapiPath);

export const docsRouter = express.Router();

// Disable caching for docs assets/spec to avoid stale UI behind CDN caches.
docsRouter.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Theme colors - Dark Nature/Garden inspired
const THEME = {
  primary: "#4fe3c1", // Neon teal
  primaryStrong: "#21a88a",
  accent: "#f2b464", // Warm amber
  accentStrong: "#f08b4b",
  background: "#0b0d14", // Deep night
  backgroundAlt: "#0f1220",
  surface: "#151a2b", // Card surface
  surfaceAlt: "#1c2340",
  border: "#2a3452",
  borderLight: "#3a4568",
  text: "#f4f6ff",
  textMuted: "#a3acc7",
  get: "#60a5fa", // Blue for GET
  post: "#34d399", // Green for POST
  put: "#f59e0b", // Amber for PUT
  delete: "#f87171", // Red for DELETE
};

// Swagger UI options with custom styling
const options = {
  customCss: `
    /*
      Magic Garden Docs v2
      Modern dark, atmospheric, glassy UI
    */

    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');

    :root {
      color-scheme: dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: radial-gradient(1200px 600px at 15% -10%, rgba(79, 227, 193, 0.15), transparent 60%),
        radial-gradient(900px 500px at 90% 0%, rgba(242, 180, 100, 0.12), transparent 55%),
        linear-gradient(180deg, ${THEME.background} 0%, ${THEME.backgroundAlt} 100%);
      color: ${THEME.text};
    }

    a {
      color: ${THEME.primary};
      text-decoration: none;
    }

    a:hover {
      color: ${THEME.accent};
    }

    .swagger-ui {
      font-family: 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: ${THEME.text};
      background: transparent;
    }

    .swagger-ui .topbar {
      display: none;
    }

    .swagger-ui .wrapper {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 28px 64px;
    }

    /* Selection */
    .swagger-ui ::selection {
      background: ${THEME.primary};
      color: ${THEME.background};
    }

    @keyframes float-in {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .swagger-ui * {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* ============================================
       HERO / HEADER
       ============================================ */

    .swagger-ui .information-container {
      padding: 48px 0 28px;
      animation: float-in 0.7s ease both;
    }

    .swagger-ui .info {
      position: relative;
      padding: 32px 32px 28px;
      border-radius: 20px;
      border: 1px solid ${THEME.border};
      background: linear-gradient(140deg, rgba(28, 35, 64, 0.8), rgba(21, 26, 43, 0.9));
      box-shadow: 0 20px 60px rgba(9, 12, 22, 0.55);
      overflow: hidden;
    }

    .swagger-ui .info::before {
      content: "";
      position: absolute;
      inset: -1px;
      border-radius: 20px;
      background: linear-gradient(120deg, rgba(79, 227, 193, 0.35), rgba(242, 180, 100, 0.25), transparent 60%);
      opacity: 0.6;
      pointer-events: none;
      mask: linear-gradient(#000, #000) content-box, linear-gradient(#000, #000);
      -webkit-mask: linear-gradient(#000, #000) content-box, linear-gradient(#000, #000);
      padding: 1px;
    }

    .swagger-ui .info hgroup.main {
      position: relative;
      z-index: 1;
      margin: 0;
    }

    .swagger-ui .info .title {
      font-size: 2.8rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: ${THEME.text};
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }

    .swagger-ui .info .title small {
      background: rgba(79, 227, 193, 0.18);
      color: ${THEME.primary};
      border: 1px solid rgba(79, 227, 193, 0.35);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .swagger-ui .info .description {
      position: relative;
      z-index: 1;
      margin-top: 18px;
      font-size: 1rem;
      line-height: 1.75;
      color: ${THEME.textMuted};
      max-width: 900px;
    }

    .swagger-ui .info .description .renderedMarkdown {
      margin-top: 18px;
      padding: 18px 22px;
      border-radius: 14px;
      border: 1px solid ${THEME.border};
      background: rgba(15, 18, 32, 0.7);
      backdrop-filter: blur(6px);
    }

    .swagger-ui .info .description h2 {
      font-size: 1.2rem;
      font-weight: 600;
      color: ${THEME.primary};
      margin: 22px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid ${THEME.borderLight};
    }

    .swagger-ui .info .description h3 {
      font-size: 1rem;
      font-weight: 600;
      color: ${THEME.accent};
      margin: 16px 0 8px;
    }

    .swagger-ui .info .description code {
      font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      background: rgba(79, 227, 193, 0.16);
      color: ${THEME.primary};
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 0.85em;
    }

    .swagger-ui .info .description pre {
      background: ${THEME.surfaceAlt};
      border: 1px solid ${THEME.border};
      border-radius: 10px;
      padding: 16px;
      overflow-x: auto;
    }

    .swagger-ui .info .description pre code {
      background: transparent;
      color: ${THEME.text};
      padding: 0;
      font-size: 0.85rem;
      line-height: 1.65;
    }

    /* ============================================
       SERVER SELECT + AUTH
       ============================================ */

    .swagger-ui .scheme-container {
      background: transparent;
      box-shadow: none;
      padding: 24px 0 0;
      border: none;
      animation: float-in 0.7s ease both;
      animation-delay: 80ms;
    }

    .swagger-ui .servers-title,
    .swagger-ui .auth-wrapper h4 {
      color: ${THEME.text};
      font-weight: 600;
    }

    .swagger-ui select {
      background: ${THEME.surface};
      color: ${THEME.text};
      border: 1px solid ${THEME.border};
      border-radius: 10px;
      padding: 10px 12px;
    }

    .swagger-ui .auth-wrapper .authorize {
      border-radius: 999px;
    }

    /* ============================================
       TAGS / SECTIONS
       ============================================ */

    .swagger-ui .opblock-tag-section {
      margin: 36px 0;
      padding: 8px 14px 12px;
      border-radius: 18px;
      border: 1px solid transparent;
      background: transparent;
      transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
      animation: float-in 0.6s ease both;
    }

    .swagger-ui .opblock-tag-section.is-open {
      background: rgba(21, 26, 43, 0.75);
      border-color: ${THEME.border};
      box-shadow: inset 0 0 0 1px rgba(79, 227, 193, 0.08), 0 16px 32px rgba(9, 12, 22, 0.45);
    }

    .swagger-ui .opblock-tag-section.is-open::before {
      content: "";
      display: block;
      height: 2px;
      width: 140px;
      margin: 2px 0 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, ${THEME.primary}, rgba(242, 180, 100, 0.6), transparent);
    }

    .swagger-ui .opblock-tag-section:nth-of-type(1) {
      animation-delay: 60ms;
    }

    .swagger-ui .opblock-tag-section:nth-of-type(2) {
      animation-delay: 120ms;
    }

    .swagger-ui .opblock-tag-section:nth-of-type(3) {
      animation-delay: 180ms;
    }

    .swagger-ui .opblock-tag {
      font-size: 1.1rem;
      font-weight: 600;
      color: ${THEME.text};
      margin: 0 0 10px;
      padding: 12px 0;
      border-bottom: 1px solid ${THEME.border};
      position: relative;
    }

    .swagger-ui .opblock-tag::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: -1px;
      width: 120px;
      height: 2px;
      background: linear-gradient(90deg, ${THEME.primary}, transparent);
    }

    .swagger-ui .opblock-tag small {
      font-size: 0.85rem;
      font-weight: 500;
      color: ${THEME.textMuted};
      margin-left: 8px;
    }

    .swagger-ui .opblock-tag .markdown p {
      font-size: 0.9rem;
      color: ${THEME.textMuted};
      margin: 10px 0 0;
      line-height: 1.6;
    }

    .swagger-ui .opblock-tag-section .opblock {
      margin-left: 6px;
      margin-right: 6px;
    }

    .swagger-ui .opblock-tag-section.is-open .opblock {
      animation: float-in 0.35s ease both;
    }

    /* ============================================
       OPERATION CARDS
       ============================================ */

    .swagger-ui .opblock {
      margin: 14px 0;
      border-radius: 16px;
      border: 1px solid ${THEME.border};
      background: ${THEME.surface};
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }

    .swagger-ui .opblock:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px rgba(9, 12, 22, 0.4);
      border-color: ${THEME.borderLight};
    }

    .swagger-ui .opblock.is-open {
      border-color: rgba(79, 227, 193, 0.55);
      box-shadow: 0 16px 34px rgba(9, 12, 22, 0.5);
      background: linear-gradient(180deg, rgba(21, 26, 43, 0.9), rgba(28, 35, 64, 0.9));
    }

    .swagger-ui .opblock.opblock-get {
      border-left: 4px solid ${THEME.get};
    }

    .swagger-ui .opblock.opblock-post {
      border-left: 4px solid ${THEME.post};
    }

    .swagger-ui .opblock.opblock-put {
      border-left: 4px solid ${THEME.put};
    }

    .swagger-ui .opblock.opblock-delete {
      border-left: 4px solid ${THEME.delete};
    }

    .swagger-ui .opblock-summary {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
    }

    .swagger-ui .opblock-summary-method {
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #0b0d14;
      padding: 7px 12px;
      border-radius: 999px;
      min-width: 64px;
      text-align: center;
      text-transform: uppercase;
    }

    .swagger-ui .opblock-summary-path {
      font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.95rem;
      color: ${THEME.text};
    }

    .swagger-ui .opblock-summary-description {
      margin-left: auto;
      font-size: 0.85rem;
      color: ${THEME.textMuted};
      text-align: right;
    }

    .swagger-ui .opblock.is-open .opblock-summary {
      background: rgba(79, 227, 193, 0.06);
      border-bottom: 1px solid ${THEME.border};
    }

    .swagger-ui .opblock.is-open .opblock-summary-method {
      box-shadow: 0 0 0 3px rgba(79, 227, 193, 0.12);
    }

    /* ============================================
       OPERATION BODY
       ============================================ */

    .swagger-ui .opblock-body {
      border-top: 1px solid ${THEME.border};
      background: rgba(21, 26, 43, 0.6);
      padding: 22px;
    }

    .swagger-ui .opblock-section-header {
      background: transparent;
      border-bottom: 1px solid ${THEME.border};
      padding: 10px 0;
    }

    .swagger-ui .opblock-section-header h4 {
      color: ${THEME.text};
      font-weight: 600;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown p {
      color: ${THEME.textMuted};
      line-height: 1.7;
      font-size: 0.95rem;
    }

    /* ============================================
       FORMS / INPUTS
       ============================================ */

    .swagger-ui input[type='text'],
    .swagger-ui input[type='password'],
    .swagger-ui input[type='search'],
    .swagger-ui input[type='email'],
    .swagger-ui input[type='number'],
    .swagger-ui textarea {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      color: ${THEME.text};
      border-radius: 10px;
      padding: 10px 12px;
      box-shadow: none;
    }

    .swagger-ui input::placeholder,
    .swagger-ui textarea::placeholder {
      color: ${THEME.textMuted};
    }

    .swagger-ui .btn {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      border-radius: 999px;
      border: 1px solid ${THEME.borderLight};
      color: ${THEME.text};
      background: rgba(21, 26, 43, 0.9);
      padding: 8px 16px;
      transition: all 0.2s ease;
      box-shadow: none;
    }

    .swagger-ui .btn:hover {
      border-color: ${THEME.primary};
      color: ${THEME.primary};
      transform: translateY(-1px);
    }

    .swagger-ui .btn.execute {
      background: linear-gradient(120deg, rgba(79, 227, 193, 0.2), rgba(79, 227, 193, 0.4));
      border-color: rgba(79, 227, 193, 0.6);
      color: ${THEME.primary};
    }

    .swagger-ui .btn.cancel {
      background: rgba(248, 113, 113, 0.15);
      border-color: rgba(248, 113, 113, 0.4);
      color: ${THEME.delete};
    }

    /* ============================================
       TABLES / RESPONSES
       ============================================ */

    .swagger-ui table {
      border-collapse: collapse;
      color: ${THEME.text};
    }

    .swagger-ui table thead tr {
      background: ${THEME.surface};
    }

    .swagger-ui table thead th {
      color: ${THEME.text};
      font-weight: 600;
    }

    .swagger-ui table tbody tr {
      border-bottom: 1px solid ${THEME.border};
    }

    .swagger-ui table tbody tr:hover {
      background: rgba(79, 227, 193, 0.06);
    }

    .swagger-ui .response-col_status {
      color: ${THEME.text};
      font-weight: 600;
    }

    .swagger-ui .response-col_description__inner,
    .swagger-ui .response-col_links,
    .swagger-ui .response .response-col_description {
      color: ${THEME.textMuted};
    }

    /* ============================================
       CODE BLOCKS
       ============================================ */

    .swagger-ui pre,
    .swagger-ui code {
      font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .swagger-ui pre {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      border-radius: 10px;
      padding: 14px;
    }

    .swagger-ui pre.microlight,
    .swagger-ui .highlight-code,
    .swagger-ui .renderedMarkdown pre {
      background: ${THEME.surface};
    }

    /* ============================================
       MODELS
       ============================================ */

    .swagger-ui section.models {
      border: 1px solid ${THEME.border};
      border-radius: 16px;
      overflow: hidden;
      background: ${THEME.surface};
    }

    .swagger-ui section.models .model-container {
      border-top: 1px solid ${THEME.border};
    }

    .swagger-ui .model-title {
      color: ${THEME.text};
    }

    .swagger-ui .model {
      color: ${THEME.text};
    }

    .swagger-ui .model .property.primitive {
      color: ${THEME.primary};
    }

    /* ============================================
       MISC
       ============================================ */

    .swagger-ui .errors-wrapper {
      background: rgba(248, 113, 113, 0.12);
      border: 1px solid rgba(248, 113, 113, 0.4);
      border-radius: 12px;
    }

    .swagger-ui .opblock-summary-control svg,
    .swagger-ui .expand-methods svg,
    .swagger-ui .expand-operation svg {
      fill: ${THEME.text};
    }

    /* ============================================
       RESPONSIVE
       ============================================ */

    @media (max-width: 960px) {
      .swagger-ui .wrapper {
        padding: 0 20px 48px;
      }

      .swagger-ui .info {
        padding: 26px 22px;
      }

      .swagger-ui .info .title {
        font-size: 2.2rem;
      }

      .swagger-ui .opblock-summary {
        flex-wrap: wrap;
      }

      .swagger-ui .opblock-summary-description {
        width: 100%;
        text-align: left;
        margin-top: 6px;
      }
    }

    @media (max-width: 640px) {
      .swagger-ui .information-container {
        padding-top: 32px;
      }

      .swagger-ui .info .title {
        font-size: 1.8rem;
      }

      .swagger-ui .opblock-summary {
        gap: 10px;
        padding: 14px 16px;
      }

      .swagger-ui .opblock-body {
        padding: 18px;
      }
    }
  `,
  customSiteTitle: "Magic Garden API Documentation",
  customfavIcon:
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌱</text></svg>",
};

// Serve OpenAPI spec as JSON
docsRouter.get("/openapi.json", (_req, res) => {
  res.json(swaggerDocument);
});

// Serve Swagger UI
docsRouter.use("/", swaggerUi.serve, swaggerUi.setup(swaggerDocument, options));
