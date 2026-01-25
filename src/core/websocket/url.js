// src/core/websocket/url.js

/**
 * Construit l'URL WebSocket pour Magic Garden.
 */
export function buildMagicGardenWsUrl({
  origin,
  version,
  roomId,
  playerId,
  anonymousUserStyle = null,
}) {
  const wsBase = origin.replace(/^http/, "ws");

  const quote = (value) => JSON.stringify(value);

  const params = new URLSearchParams();
  params.set("surface", quote("web"));
  params.set("platform", quote("desktop"));
  params.set("playerId", quote(playerId));
  params.set("version", quote(version));
  params.set("source", quote("manualUrl"));
  params.set("capabilities", quote("fbo_mipmap_unsupported"));

  if (anonymousUserStyle) {
    params.set(
      "anonymousUserStyle",
      typeof anonymousUserStyle === "string"
        ? anonymousUserStyle
        : JSON.stringify(anonymousUserStyle)
    );
  }

  return `${wsBase}/version/${version}/api/rooms/${roomId}/connect?${params}`;
}
