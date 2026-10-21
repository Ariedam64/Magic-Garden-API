// src/services/syncPlan.js

/**
 * Décisions de la sync de sprites, isolées en fonctions pures pour pouvoir les
 * tester sans réseau ni rendu.
 *
 * La règle commune : **une montée de version du jeu ne dit rien des `.riv`.**
 * Ils sont servis sous des URL versionnées par hash de contenu
 * (`/runtime-assets/pets.<hash>.riv`), c'est donc l'URL qui dit si un rendu est
 * à refaire, pas la version. Le `force` d'une resync après mise à jour ne
 * concerne que les atlas ; seul `forceRive`, explicite, saute la comparaison
 * d'URL.
 */

/**
 * Faut-il re-rendre les PNG de pets ?
 *
 * @param {object} options
 * @param {Array<{ key: string, url: string }>} options.files - .riv de pets du manifest courant
 * @param {Record<string, { url?: string }>} options.stored - Exports enregistrés (rive-assets.json)
 * @param {boolean} options.sidecarExists - Le sidecar des frames est-il sur disque ?
 * @param {boolean} options.forceRive - Forçage explicite du rendu Rive
 * @returns {{ render: boolean, reason: string, changed: Array<{ key: string, from: string|null, to: string }> }}
 */
export function planPetSprites({ files = [], stored = {}, sidecarExists = true, forceRive = false } = {}) {
  const changed = files
    .filter((f) => stored[f.key]?.url !== f.url)
    .map((f) => ({ key: f.key, from: stored[f.key]?.url ?? null, to: f.url }));

  if (!files.length) return { render: false, reason: "rive_not_in_manifest", changed };
  if (forceRive) return { render: true, reason: "forced", changed };
  if (changed.length) return { render: true, reason: "rive_changed", changed };
  // URL inchangées mais PNG absents (dossier d'export vidé, nouvelle install
  // qui a gardé `data/`) : sans ce cas, les pets ne seraient jamais rendus.
  if (!sidecarExists) return { render: true, reason: "sidecar_missing", changed };
  return { render: false, reason: "unchanged", changed };
}

/**
 * Faut-il relancer l'export des PNG de décors absents des atlas ?
 *
 * Son résultat dépend de deux choses : `decor.riv` (ce qui peut être rendu) et
 * les atlas (ce qu'ils fournissent déjà, et qui prime). Les atlas ne bougent
 * qu'avec la version du jeu.
 *
 * @param {object} options
 * @param {boolean} options.versionChanged
 * @param {string|null} options.currentUrl - URL courante de `decor.riv`
 * @param {string|null} options.storedUrl - URL du dernier export réussi
 * @param {boolean} options.sidecarExists
 * @param {boolean} options.forceRive
 * @returns {{ render: boolean, reason: string }}
 */
export function planDecorSprites({
  versionChanged = false,
  currentUrl = null,
  storedUrl = null,
  sidecarExists = true,
  forceRive = false,
} = {}) {
  if (!currentUrl) return { render: false, reason: "rive_not_in_manifest" };
  if (forceRive) return { render: true, reason: "forced" };
  if (currentUrl !== storedUrl) return { render: true, reason: "rive_changed" };
  if (!sidecarExists) return { render: true, reason: "sidecar_missing" };
  if (versionChanged) return { render: true, reason: "version_changed" };
  return { render: false, reason: "unchanged" };
}
