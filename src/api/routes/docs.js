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
  primary: "#52b788", // Bright green
  primaryLight: "#74c69d",
  primaryDark: "#2d6a4f",
  accent: "#95d5b2",
  accentDark: "#52b788",
  background: "#0d1117", // Dark background
  backgroundLight: "#161b22",
  surface: "#1c2128", // Card background
  surfaceLight: "#22272e",
  border: "#30363d",
  borderLight: "#444c56",
  text: "#e6edf3", // Light text
  textMuted: "#8b949e", // Muted text
  get: "#58a6ff", // Blue for GET
  post: "#3fb950", // Green for POST
  put: "#d29922", // Amber for PUT
  delete: "#f85149", // Red for DELETE
};

// Swagger UI options with custom styling
const options = {
  customCss: `
    /* ============================================
       BASE & RESET
       ============================================ */

    body {
      background: ${THEME.background};
    }

    .swagger-ui {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: ${THEME.text};
      background: ${THEME.background};
    }

    .swagger-ui .topbar {
      display: none;
    }

    .swagger-ui .wrapper {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* Selection */
    .swagger-ui ::selection {
      background: ${THEME.primary};
      color: ${THEME.background};
    }

    /* ============================================
       HEADER
       ============================================ */

    .swagger-ui .information-container {
      padding-top: 40px;
    }

    .swagger-ui .info {
      margin: 0 0 32px 0;
    }

    .swagger-ui .info hgroup.main {
      margin: 0;
    }

    .swagger-ui .info .title {
      font-size: 2.25rem;
      font-weight: 700;
      color: ${THEME.primary};
      margin-bottom: 8px;
    }

    .swagger-ui .info .title small {
      background: rgba(82, 183, 136, 0.2);
      color: ${THEME.primary};
      border: 1px solid ${THEME.primary};
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-left: 12px;
      vertical-align: middle;
    }

    .swagger-ui .info .title small pre {
      margin: 0;
      padding: 0;
      background: transparent;
    }

    .swagger-ui .info .description {
      font-size: 0.9375rem;
      line-height: 1.7;
      color: ${THEME.textMuted};
      max-width: 800px;
    }

    .swagger-ui .info .description .renderedMarkdown {
      padding: 24px;
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      border-radius: 12px;
      margin-top: 16px;
    }

    .swagger-ui .info .description h2 {
      font-size: 1.25rem;
      font-weight: 600;
      color: ${THEME.primary};
      margin: 24px 0 12px 0;
      padding-bottom: 8px;
      border-bottom: 2px solid ${THEME.primaryDark};
    }

    .swagger-ui .info .description h2:first-child {
      margin-top: 0;
    }

    .swagger-ui .info .description h3 {
      font-size: 1rem;
      font-weight: 600;
      color: ${THEME.primaryLight};
      margin: 16px 0 8px 0;
    }

    .swagger-ui .info .description p {
      margin: 12px 0;
      color: ${THEME.textMuted};
    }

    .swagger-ui .info .description ul,
    .swagger-ui .info .description ol {
      margin: 12px 0 12px 24px;
      color: ${THEME.textMuted};
    }

    .swagger-ui .info .description li {
      margin: 6px 0;
    }

    .swagger-ui .info .description code {
      background: rgba(82, 183, 136, 0.15);
      color: ${THEME.primary};
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.875em;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    }

    .swagger-ui .info .description pre {
      background: ${THEME.backgroundLight};
      border: 1px solid ${THEME.border};
      border-radius: 8px;
      padding: 16px;
      margin: 12px 0;
      overflow-x: auto;
    }

    .swagger-ui .info .description pre code {
      background: transparent;
      color: ${THEME.text};
      padding: 0;
      font-size: 0.8125rem;
      line-height: 1.6;
    }

    /* ============================================
       TAGS / SECTIONS
       ============================================ */

    .swagger-ui .opblock-tag-section {
      margin-bottom: 32px;
    }

    .swagger-ui .opblock-tag {
      font-size: 1.125rem;
      font-weight: 600;
      color: ${THEME.primary};
      padding: 16px 0;
      margin: 0;
      border-bottom: 2px solid ${THEME.border};
      background: transparent;
      transition: border-color 0.2s ease;
    }

    .swagger-ui .opblock-tag:hover {
      border-bottom-color: ${THEME.primaryLight};
    }

    .swagger-ui .opblock-tag small {
      font-size: 0.875rem;
      font-weight: 400;
      color: ${THEME.textMuted};
      margin-left: 8px;
    }

    .swagger-ui .opblock-tag .markdown p {
      font-size: 0.875rem;
      color: ${THEME.textMuted};
      margin: 8px 0 0 0;
      line-height: 1.6;
    }

    /* ============================================
       OPERATION BLOCKS (Endpoints)
       ============================================ */

    .swagger-ui .opblock {
      margin: 12px 0;
      border: 1px solid ${THEME.border};
      border-radius: 8px;
      background: ${THEME.surface};
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }

    .swagger-ui .opblock:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    /* GET */
    .swagger-ui .opblock.opblock-get {
      border-left: 4px solid ${THEME.get};
      background: rgba(88, 166, 255, 0.05);
    }

    .swagger-ui .opblock.opblock-get .opblock-summary-method {
      background: ${THEME.get};
    }

    .swagger-ui .opblock.opblock-get.is-open {
      background: rgba(88, 166, 255, 0.08);
    }

    /* POST */
    .swagger-ui .opblock.opblock-post {
      border-left: 4px solid ${THEME.post};
      background: rgba(63, 185, 80, 0.05);
    }

    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: ${THEME.post};
    }

    .swagger-ui .opblock.opblock-post.is-open {
      background: rgba(63, 185, 80, 0.08);
    }

    /* PUT */
    .swagger-ui .opblock.opblock-put {
      border-left: 4px solid ${THEME.put};
      background: rgba(210, 153, 34, 0.05);
    }

    .swagger-ui .opblock.opblock-put .opblock-summary-method {
      background: ${THEME.put};
    }

    .swagger-ui .opblock.opblock-put.is-open {
      background: rgba(210, 153, 34, 0.08);
    }

    /* DELETE */
    .swagger-ui .opblock.opblock-delete {
      border-left: 4px solid ${THEME.delete};
      background: rgba(248, 81, 73, 0.05);
    }

    .swagger-ui .opblock.opblock-delete .opblock-summary-method {
      background: ${THEME.delete};
    }

    .swagger-ui .opblock.opblock-delete.is-open {
      background: rgba(248, 81, 73, 0.08);
    }

    /* Summary */
    .swagger-ui .opblock-summary {
      padding: 12px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .swagger-ui .opblock-summary-method {
      font-size: 0.75rem;
      font-weight: 700;
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      min-width: 60px;
      text-align: center;
    }

    .swagger-ui .opblock-summary-path {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.9375rem;
      font-weight: 500;
      color: ${THEME.text};
    }

    .swagger-ui .opblock-summary-path__deprecated {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .swagger-ui .opblock-summary-description {
      font-size: 0.875rem;
      color: ${THEME.textMuted};
      flex: 1;
      text-align: right;
    }

    /* ============================================
       OPERATION BODY (Expanded)
       ============================================ */

    .swagger-ui .opblock-body {
      padding: 20px;
      border-top: 1px solid ${THEME.border};
      background: ${THEME.backgroundLight};
    }

    .swagger-ui .opblock-body pre {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      border-radius: 6px;
      padding: 12px;
    }

    .swagger-ui .opblock-body pre code {
      color: ${THEME.text};
    }

    .swagger-ui .opblock-description-wrapper {
      padding: 0 0 16px 0;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown p {
      font-size: 0.9375rem;
      color: ${THEME.textMuted};
      line-height: 1.6;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown h4 {
      font-size: 0.875rem;
      font-weight: 600;
      color: ${THEME.primary};
      margin: 16px 0 8px 0;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown code {
      background: rgba(82, 183, 136, 0.15);
      color: ${THEME.primary};
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.8125em;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown pre code {
      background: transparent;
      color: ${THEME.text};
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown ul {
      margin: 8px 0 8px 20px;
    }

    .swagger-ui .opblock-description-wrapper .renderedMarkdown li {
      margin: 4px 0;
      color: ${THEME.textMuted};
    }

    /* ============================================
       PARAMETERS
       ============================================ */

    .swagger-ui .opblock-section-header {
      padding: 12px 0;
      border-bottom: 1px solid ${THEME.border};
      margin-bottom: 12px;
    }

    .swagger-ui .opblock-section-header h4 {
      font-size: 0.875rem;
      font-weight: 600;
      color: ${THEME.primary};
      margin: 0;
    }

    .swagger-ui .parameters-container {
      background: ${THEME.surface};
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .swagger-ui table.parameters {
      width: 100%;
    }

    .swagger-ui .parameters th {
      font-size: 0.75rem;
      font-weight: 600;
      color: ${THEME.textMuted};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 12px;
      border-bottom: 1px solid ${THEME.border};
    }

    .swagger-ui .parameters td {
      padding: 12px;
      border-bottom: 1px solid ${THEME.border};
      vertical-align: top;
    }

    .swagger-ui .parameters tr:last-child td {
      border-bottom: none;
    }

    .swagger-ui .parameter__name {
      font-weight: 600;
      color: ${THEME.text};
      font-size: 0.875rem;
    }

    .swagger-ui .parameter__name.required::after {
      content: "*";
      color: ${THEME.delete};
      margin-left: 4px;
    }

    .swagger-ui .parameter__type {
      font-size: 0.75rem;
      color: ${THEME.primaryLight};
      font-family: 'SF Mono', Monaco, monospace;
    }

    .swagger-ui .parameter__in {
      font-size: 0.6875rem;
      color: ${THEME.textMuted};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* ============================================
       RESPONSES
       ============================================ */

    .swagger-ui .responses-wrapper {
      padding: 0;
    }

    .swagger-ui .responses-inner {
      padding: 16px;
      background: ${THEME.backgroundLight};
      border-radius: 8px;
    }

    .swagger-ui .response {
      margin: 12px 0;
    }

    .swagger-ui .response-col_status {
      font-family: 'SF Mono', Monaco, monospace;
      font-weight: 600;
    }

    .swagger-ui .response-col_status .response-undocumented {
      color: ${THEME.textMuted};
    }

    .swagger-ui .responses-table {
      width: 100%;
    }

    .swagger-ui .responses-table thead {
      display: none;
    }

    .swagger-ui .responses-table td {
      padding: 12px;
      border-bottom: 1px solid ${THEME.border};
    }

    /* ============================================
       BUTTONS
       ============================================ */

    .swagger-ui .btn {
      font-size: 0.8125rem;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 6px;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .swagger-ui .btn.try-out__btn {
      background: ${THEME.primary};
      border: none;
      color: white;
    }

    .swagger-ui .btn.try-out__btn:hover {
      background: ${THEME.primaryDark};
    }

    .swagger-ui .btn.try-out__btn.cancel {
      background: ${THEME.textMuted};
    }

    .swagger-ui .btn.execute {
      background: ${THEME.post};
      border: none;
      color: white;
    }

    .swagger-ui .btn.execute:hover {
      background: #16a34a;
    }

    .swagger-ui .btn-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    /* ============================================
       MODELS / SCHEMAS
       ============================================ */

    .swagger-ui section.models {
      margin-top: 48px;
      padding-top: 32px;
      border-top: 2px solid ${THEME.border};
    }

    .swagger-ui section.models h4 {
      font-size: 1.5rem;
      font-weight: 700;
      color: ${THEME.primary};
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .swagger-ui section.models h4::before {
      content: "";
      width: 4px;
      height: 24px;
      background: ${THEME.primary};
      border-radius: 2px;
    }

    .swagger-ui section.models .model-container {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      border-radius: 8px;
      margin: 12px 0;
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .swagger-ui section.models .model-container:hover {
      background: ${THEME.surfaceLight};
      border-color: ${THEME.borderLight};
      box-shadow: 0 2px 8px rgba(82, 183, 136, 0.1);
    }

    .swagger-ui .model-box {
      padding: 0;
    }

    .swagger-ui .model-box .model-title {
      padding: 16px;
      margin: 0;
      background: ${THEME.backgroundLight};
      border-bottom: 1px solid ${THEME.border};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.2s ease;
    }

    .swagger-ui .model-box .model-title:hover {
      background: rgba(82, 183, 136, 0.05);
    }

    .swagger-ui .model {
      font-size: 0.875rem;
      padding: 16px;
    }

    .swagger-ui .model-title {
      font-weight: 600;
      font-size: 1rem;
      color: ${THEME.primary};
    }

    .swagger-ui .model-toggle {
      font-weight: 600;
      color: ${THEME.text};
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .swagger-ui .model-toggle::after {
      content: "";
      display: inline-block;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 5px 5px 0 5px;
      border-color: ${THEME.text} transparent transparent transparent;
      transition: transform 0.2s ease;
    }

    .swagger-ui .model-toggle.collapsed::after {
      transform: rotate(-90deg);
    }

    .swagger-ui .model .property {
      padding: 8px 0;
      border-bottom: 1px solid rgba(48, 54, 61, 0.5);
    }

    .swagger-ui .model .property:last-child {
      border-bottom: none;
    }

    .swagger-ui .model .property.primitive {
      color: ${THEME.primaryLight};
    }

    .swagger-ui .prop-name {
      color: ${THEME.text};
      font-weight: 600;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.875rem;
    }

    .swagger-ui .prop-type {
      color: ${THEME.primaryLight};
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.8125rem;
      background: rgba(82, 183, 136, 0.1);
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
    }

    .swagger-ui .prop-format {
      color: ${THEME.textMuted};
      font-size: 0.75rem;
      font-style: italic;
    }

    .swagger-ui .model .deprecated {
      text-decoration: line-through;
      opacity: 0.6;
    }

    .swagger-ui .model-box-control {
      color: ${THEME.text};
      transition: color 0.2s ease;
    }

    .swagger-ui .model-box-control:hover {
      color: ${THEME.primary};
    }

    .swagger-ui .model .description {
      color: ${THEME.textMuted};
      font-size: 0.8125rem;
      margin-top: 4px;
      line-height: 1.5;
    }

    .swagger-ui .model .required {
      color: ${THEME.delete};
      font-size: 0.75rem;
      font-weight: 600;
      margin-left: 4px;
    }

    .swagger-ui .model .example {
      background: ${THEME.backgroundLight};
      border: 1px solid ${THEME.border};
      border-radius: 6px;
      padding: 12px;
      margin-top: 12px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.8125rem;
      color: ${THEME.text};
    }

    .swagger-ui .model .example .example-title {
      color: ${THEME.textMuted};
      font-size: 0.75rem;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .swagger-ui .prop-enum {
      color: ${THEME.accent};
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.75rem;
    }

    /* ============================================
       CODE & JSON
       ============================================ */

    .swagger-ui .highlight-code,
    .swagger-ui .microlight {
      background: ${THEME.surface} !important;
      border: 1px solid ${THEME.border} !important;
      border-radius: 6px;
      padding: 16px !important;
      font-size: 0.8125rem !important;
      line-height: 1.6 !important;
    }

    .swagger-ui .microlight {
      color: ${THEME.text} !important;
    }

    /* JSON syntax highlighting */
    .swagger-ui .microlight .hljs-attr {
      color: ${THEME.primaryLight};
    }

    .swagger-ui .microlight .hljs-string {
      color: ${THEME.accent};
    }

    .swagger-ui .microlight .hljs-number {
      color: ${THEME.get};
    }

    .swagger-ui .microlight .hljs-literal {
      color: ${THEME.put};
    }

    /* ============================================
       TABS
       ============================================ */

    .swagger-ui .tab {
      margin: 0;
      padding: 0;
      display: flex;
      gap: 4px;
    }

    .swagger-ui .tab li {
      font-size: 0.8125rem;
      padding: 8px 16px;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
      color: ${THEME.textMuted};
      transition: all 0.2s ease;
    }

    .swagger-ui .tab li.active {
      background: ${THEME.surfaceLight};
      color: ${THEME.primary};
      font-weight: 600;
      border: 1px solid ${THEME.border};
      border-bottom: 1px solid ${THEME.surfaceLight};
    }

    .swagger-ui .tab li:hover:not(.active) {
      background: rgba(82, 183, 136, 0.1);
    }

    /* ============================================
       SCROLLBAR
       ============================================ */

    .swagger-ui ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    .swagger-ui ::-webkit-scrollbar-track {
      background: ${THEME.backgroundLight};
      border-radius: 4px;
    }

    .swagger-ui ::-webkit-scrollbar-thumb {
      background: ${THEME.borderLight};
      border-radius: 4px;
    }

    .swagger-ui ::-webkit-scrollbar-thumb:hover {
      background: ${THEME.primary};
    }

    /* ============================================
       EXAMPLE SELECTOR
       ============================================ */

    .swagger-ui .examples-select {
      margin: 12px 0;
    }

    .swagger-ui .examples-select select {
      padding: 8px 12px;
      border: 1px solid ${THEME.border};
      border-radius: 6px;
      font-size: 0.875rem;
      background: ${THEME.surface};
      color: ${THEME.text};
    }

    /* ============================================
       INPUTS & FORMS
       ============================================ */

    .swagger-ui input[type="text"],
    .swagger-ui input[type="password"],
    .swagger-ui input[type="email"],
    .swagger-ui textarea,
    .swagger-ui select {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      color: ${THEME.text};
    }

    .swagger-ui input[type="text"]:focus,
    .swagger-ui input[type="password"]:focus,
    .swagger-ui input[type="email"]:focus,
    .swagger-ui textarea:focus,
    .swagger-ui select:focus {
      border-color: ${THEME.primary};
      outline: none;
      box-shadow: 0 0 0 2px rgba(82, 183, 136, 0.2);
    }

    .swagger-ui .opblock-body select,
    .swagger-ui .parameters select {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      color: ${THEME.text};
    }

    /* ============================================
       MODALS & DIALOGS
       ============================================ */

    .swagger-ui .dialog-ux {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
    }

    .swagger-ui .modal-ux {
      background: rgba(13, 17, 23, 0.8);
    }

    .swagger-ui .modal-ux-content {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
    }

    /* ============================================
       COPY BUTTON
       ============================================ */

    .swagger-ui .copy-to-clipboard {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
    }

    .swagger-ui .copy-to-clipboard:hover {
      background: ${THEME.surfaceLight};
    }

    .swagger-ui .copy-to-clipboard button {
      color: ${THEME.text};
    }

    /* ============================================
       AUTHORIZATION
       ============================================ */

    .swagger-ui .auth-wrapper {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
      padding: 1.5rem;
      border-radius: 8px;
    }

    .swagger-ui .auth-wrapper .authorize {
      background: ${THEME.primary};
      border-color: ${THEME.primary};
    }

    .swagger-ui .auth-wrapper .authorize:hover {
      background: ${THEME.primaryLight};
      border-color: ${THEME.primaryLight};
    }

    .swagger-ui .auth-container {
      background: ${THEME.backgroundLight};
      border: 1px solid ${THEME.border};
    }

    /* ============================================
       LINKS
       ============================================ */

    .swagger-ui a {
      color: ${THEME.primary};
    }

    .swagger-ui a:hover {
      color: ${THEME.primaryLight};
    }

    .swagger-ui a:visited {
      color: ${THEME.accentDark};
    }

    /* ============================================
       LOADING ANIMATION
       ============================================ */

    .swagger-ui .loading-container .loading::after {
      border-color: ${THEME.primary} transparent ${THEME.primary} transparent;
    }

    /* ============================================
       TABLES
       ============================================ */

    .swagger-ui table {
      background: transparent;
      color: ${THEME.text};
    }

    .swagger-ui table thead tr {
      background: ${THEME.backgroundLight};
      border-bottom: 1px solid ${THEME.border};
    }

    .swagger-ui table tbody tr {
      border-bottom: 1px solid ${THEME.border};
    }

    .swagger-ui table tbody tr:hover {
      background: rgba(82, 183, 136, 0.05);
    }

    /* ============================================
       SCHEMA / MODELS
       ============================================ */

    .swagger-ui .model {
      color: ${THEME.text};
    }

    .swagger-ui .model-toggle {
      color: ${THEME.text};
    }

    .swagger-ui .model-toggle::after {
      background: ${THEME.border};
    }

    .swagger-ui .model-box-control {
      color: ${THEME.text};
    }

    .swagger-ui section.models .model-container {
      background: ${THEME.surface};
      border: 1px solid ${THEME.border};
    }

    .swagger-ui section.models .model-container:hover {
      background: ${THEME.surfaceLight};
    }

    .swagger-ui .model .property {
      color: ${THEME.text};
    }

    .swagger-ui .model .property.primitive {
      color: ${THEME.primaryLight};
    }

    /* ============================================
       RESPONSES
       ============================================ */

    .swagger-ui .response-col_status {
      color: ${THEME.text};
    }

    .swagger-ui .response-col_description__inner {
      color: ${THEME.textMuted};
    }

    .swagger-ui .responses-table td {
      color: ${THEME.text};
    }

    /* ============================================
       OPBLOCK SUMMARY HOVER
       ============================================ */

    .swagger-ui .opblock-summary:hover {
      background-color: rgba(82, 183, 136, 0.05);
    }

    /* ============================================
       BADGES & CHIPS
       ============================================ */

    .swagger-ui .opblock-summary-control svg {
      fill: ${THEME.text};
    }

    .swagger-ui .expand-methods svg,
    .swagger-ui .expand-operation svg {
      fill: ${THEME.text};
    }

    /* ============================================
       RESPONSE HEADERS
       ============================================ */

    .swagger-ui .response-col_links {
      color: ${THEME.text};
    }

    .swagger-ui .response .response-col_description {
      color: ${THEME.textMuted};
    }

    /* ============================================
       RESPONSIVE
       ============================================ */

    @media (max-width: 768px) {
      .swagger-ui .wrapper {
        padding: 0 16px;
      }

      .swagger-ui .info .title {
        font-size: 1.75rem;
      }

      .swagger-ui .opblock-summary {
        flex-wrap: wrap;
      }

      .swagger-ui .opblock-summary-description {
        width: 100%;
        text-align: left;
        margin-top: 8px;
      }

      .swagger-ui .opblock-summary-method {
        min-width: 50px;
        font-size: 0.6875rem;
        padding: 4px 8px;
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
