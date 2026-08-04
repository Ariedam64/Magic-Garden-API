// src/services/riveSync.js

import { logger } from "../logger/index.js";
import { resolveRiveAssets } from "../assets/sprites/riveManifest.js";
import { inspectRiveFile } from "../assets/sprites/riveInspector.js";
import { loadRiveInventory, saveRiveInventory } from "../core/game/riveStorage.js";

/**
 * Tient à jour l'inventaire des fichiers Rive du jeu.
 *
 * Les `.riv` sont la seule source vectorielle du jeu, et le manifest en déclare
 * six répartis dans cinq bundles. Les inspecter à la sync plutôt qu'à la
 * requête est indispensable : chacun demande un téléchargement et une passe du
 * runtime WASM.
 *
 * Le travail est piloté par l'URL, versionnée par hash de contenu : une entrée
 * dont l'URL n'a pas bougé est reprise telle quelle. C'est ce qui rend cette
 * étape quasi gratuite en régime établi — y compris pour les fichiers dont
 * l'inspection **a échoué**, qu'on ne réessaie donc pas à chaque sync.
 */

/**
 * @param {object} options
 * @param {string|null} options.baseUrl
 * @param {boolean} options.force - Réinspecte même les URL inchangées
 * @returns {Promise<{ files: number, inspected: number, reused: number, failed: number }>}
 */
export async function syncRiveInventory({ baseUrl = null, force = false } = {}) {
  const assets = await resolveRiveAssets({ baseUrl });

  if (!assets.length) {
    logger.warn("No Rive file found in the manifest");
    return { files: 0, inspected: 0, reused: 0, failed: 0 };
  }

  const { files: previous } = await loadRiveInventory();
  const files = {};

  let inspected = 0;
  let reused = 0;
  let failed = 0;

  for (const asset of assets) {
    const known = previous[asset.key];

    if (!force && known?.url === asset.url) {
      files[asset.key] = { ...known, aliases: asset.aliases, bundle: asset.bundle };
      reused++;
      if (!known.loadable) failed++;
      continue;
    }

    logger.info({ key: asset.key, url: asset.url }, "Inspecting Rive file");
    const described = await inspectRiveFile(asset.url);

    files[asset.key] = {
      key: asset.key,
      aliases: asset.aliases,
      bundle: asset.bundle,
      ...described,
      inspectedAt: new Date().toISOString(),
    };

    inspected++;
    if (!described.loadable) {
      failed++;
      logger.warn({ key: asset.key, error: described.error }, "Rive file could not be inspected");
    }
  }

  await saveRiveInventory(files);

  logger.info(
    { files: assets.length, inspected, reused, failed },
    "Rive inventory synced"
  );

  return { files: assets.length, inspected, reused, failed };
}
