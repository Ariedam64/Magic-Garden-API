// src/core/game/bundle/index.js

export { fetchText, resolveMainFromPage, fetchMainBundle } from "./resolver.js";

export {
  extractBalancedBraces,
  extractBalancedParens,
  findObjectLiteralBySignatures,
  runObjectLiteral,
  extractCategoryWithSandbox,
} from "./extractor.js";

export {
  makeEnumProxy,
  makeGlobalSandboxProxy,
  tryExtractStringEnum,
  tryExtractCcEnum,
  clearEnumCaches,
} from "./sandbox.js";
