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
  clearEnumCaches,
} from "./sandbox.js";

export {
  extractSpriteMapping,
  clearSpriteMappingCache,
} from "./spriteMapping.js";
