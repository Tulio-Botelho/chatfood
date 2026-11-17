// O HTML recebe somente as versões dos arquivos públicos; dados de conta nunca entram neste mapa.
let source = null, versions = {};

export function assetUrl(path) {
  if (!path || /^(?:https?:|data:|blob:|\/\/)/i.test(path)) return path;
  const element = globalThis.document?.getElementById("asset-versions");
  if (element !== source) {
    source = element;
    try { versions = JSON.parse(element?.textContent || "{}"); } catch { versions = {}; }
  }
  const key = "/" + path.replace(/^\/+/, "").split("?")[0];
  return versions[key] ? key + "?v=" + versions[key] : path;
}
