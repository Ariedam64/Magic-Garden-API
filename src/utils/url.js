export function joinUrl(baseUrl, relativePath) {
  return new URL(relativePath, baseUrl).toString();
}
