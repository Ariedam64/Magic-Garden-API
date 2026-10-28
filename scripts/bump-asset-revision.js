#!/usr/bin/env node
// scripts/bump-asset-revision.js

import { loadStoredVersion, saveVersion } from "../src/core/game/versionStorage.js";

/**
 * Fait avancer la révision des assets sans mise à jour du jeu : le `?v=` des
 * URL de sprites et d'animations passe de `1778` à `1778-r1` (puis `-r2`…),
 * et les navigateurs rechargent les fichiers au lieu de servir leur copie
 * `immutable`. À lancer quand des fichiers déjà servis ont été corrigés ou
 * régénérés à la main. L'API reprend le nouveau jeton en moins d'une minute,
 * sans redémarrage.
 *
 *   npm run assets:bump
 */

const version = await loadStoredVersion();
if (!version) {
  console.error("No stored game version (data/version.json): nothing to bump.");
  process.exit(1);
}

await saveVersion(version);
process.exit(0);
