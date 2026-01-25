// src/core/websocket/closeCodes.js

/**
 * Codes de fermeture WebSocket personnalisés du jeu Magic Garden.
 */
export const CloseCodes = {
  /**
   * Reconnexion initiée par le client.
   *
   * Déclenché quand: Le client initie volontairement une reconnexion
   * Comportement client: Reconnexion immédiate (pas d'attente)
   * Auto-reconnexion: Autorisée
   *
   * @type {number}
   */
  RECONNECT_INITIATED: 4100,

  /**
   * Le joueur a quitté volontairement la session.
   *
   * Déclenché quand: Le joueur ferme le jeu ou le navigateur
   * Comportement client: Session terminée, pas de reconnexion
   * Auto-reconnexion: Autorisée
   *
   * @type {number}
   */
  PLAYER_LEFT_VOLUNTARILY: 4200,

  /**
   * Session utilisateur remplacée (nouvel onglet/appareil).
   *
   * Déclenché quand: Même joueur connecté dans un autre onglet/appareil
   * Comportement client: Cette session est invalide, se déconnecter
   * Auto-reconnexion: Autorisée
   * Remarque: Une seule session active par utilisateur
   *
   * @type {number}
   */
  USER_SESSION_SUPERSEDED: 4250,

  /**
   * Connexion remplacée dans la même session.
   *
   * Déclenché quand: Nouvelle connexion WebSocket pour le même room/joueur
   * Comportement client: Ancienne connexion invalide, utiliser nouvelle
   * Auto-reconnexion: Autorisée
   *
   * @type {number}
   */
  CONNECTION_SUPERSEDED: 4300,

  /**
   * Instance serveur fermée (Hot Module Replacement).
   *
   * Déclenché quand: Serveur redémarrage ou mise à jour en direct
   * Comportement client: Attendre et reconnectez automatiquement
   * Auto-reconnexion: Autorisée
   * Remarque: Déclenché uniquement en développement/déploiement
   *
   * @type {number}
   */
  SERVER_DISPOSED: 4310,

  /**
   * Heartbeat (ping/pong) expiré.
   *
   * Déclenché quand: Serveur n'a pas reçu de réponse pong à temps
   * Comportement client: Connexion morte, reconnectez
   * Auto-reconnexion: Autorisée
   * Remarque: Indique problème réseau ou client figé
   *
   * @type {number}
   */
  HEARTBEAT_EXPIRED: 4400,

  /**
   * Joueur expulsé par un autre joueur ou l'administrateur.
   *
   * Déclenché quand: Modérateur/admin expulse le joueur
   * Comportement client: Session invalide, déconnexion permanente
   * Auto-reconnexion: Interdite (code dans NO_RECONNECT_CODES)
   * Remarque: Requiert intervention/déblocage
   *
   * @type {number}
   */
  PLAYER_KICKED: 4500,

  /**
   * Mismatch de version client/serveur.
   *
   * Déclenché quand: Client se connecte avec version obsolète
   * Comportement client: Déclenche export sprite et redémarrage serveur
   * Auto-reconnexion: Interdite (requiert mise à jour version)
   * API action: Lance synchronisation automatique des sprites
   *
   * @type {number}
   */
  VERSION_MISMATCH: 4700,

  /**
   * Version du jeu expirée (mise à jour du jeu détectée).
   *
   * Déclenché quand: Serveur détecte que client utilise version obsolète
   * Comportement client: Déclenche export sprite et redémarrage serveur
   * Auto-reconnexion: Interdite (version du serveur non compatible)
   * API action: Lance synchronisation automatique des sprites
   * Remarque: Version du serveur non compatible, client doit se mettre à jour
   *
   * @type {number}
   */
  VERSION_EXPIRED: 4710,

  /**
   * Échec d'authentification ou d'autorisation.
   *
   * Déclenché quand: Token invalide, expiré, ou permissions insuffisantes
   * Comportement client: Session invalide, nouvelle authentification requise
   * Auto-reconnexion: Interdite (code dans NO_RECONNECT_CODES)
   * Remarque: Requiert nouvel authentification ou récupération du token
   *
   * @type {number}
   */
  AUTHENTICATION_FAILURE: 4800,
};

/**
 * Codes de fermeture qui empêchent la reconnexion automatique.
 */
export const NO_RECONNECT_CODES = new Set([
  CloseCodes.AUTHENTICATION_FAILURE,
  CloseCodes.PLAYER_KICKED,
  CloseCodes.VERSION_EXPIRED,
]);

/**
 * Retourne un message lisible pour un code de fermeture.
 */
export function getCloseCodeMessage(code) {
  const messages = {
    [CloseCodes.RECONNECT_INITIATED]: "Reconnect initiated",
    [CloseCodes.PLAYER_LEFT_VOLUNTARILY]: "Player left voluntarily",
    [CloseCodes.USER_SESSION_SUPERSEDED]: "User session superseded",
    [CloseCodes.CONNECTION_SUPERSEDED]: "Connection superseded",
    [CloseCodes.SERVER_DISPOSED]: "Server disposed",
    [CloseCodes.HEARTBEAT_EXPIRED]: "Heartbeat expired",
    [CloseCodes.PLAYER_KICKED]: "Player kicked",
    [CloseCodes.VERSION_MISMATCH]: "Version mismatch",
    [CloseCodes.VERSION_EXPIRED]: "Version expired",
    [CloseCodes.AUTHENTICATION_FAILURE]: "Authentication failure",
  };

  return messages[code] || `Unknown close code: ${code}`;
}
