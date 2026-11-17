// Comunicação com o backend. Nenhuma credencial de IA passa pelo navegador.
let sessionToken = null, recoverSession = null;
export function setSessionToken(token) { sessionToken = token || null; }
export function setSessionRecovery(callback) { recoverSession = callback; }
function apiBase() {
  const q = new URLSearchParams(globalThis.location?.search || "").get("api");
  return (q || globalThis.FOODAGENT_API || "").replace(/\/$/, "");
}

async function request(path, options) {
  const protectedRequest = path.startsWith("/api/") && !path.startsWith("/api/auth/")
    && !["/api/config/public", "/api/health"].includes(path);
  const token = sessionToken;
  const headers = { ...options?.headers };
  if (protectedRequest && token && (!options?.method || options.method === "GET")) headers["X-CSRF-Token"] = token;
  let res;
  try {
    res = await fetch(apiBase() + path, { credentials: "include", ...(protectedRequest ? { cache: "no-store" } : {}), ...options, headers });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Não consegui falar com o servidor. Verifique se o backend está rodando.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* corpo vazio */ }
  if (!res.ok) {
    // Atualiza a identidade antes de propagar o erro, sem repetir compras ou outras alterações.
    if (protectedRequest && [401, 403].includes(res.status) && recoverSession) {
      try { await recoverSession(token); } catch { /* preservar o erro original */ }
    }
    const detail = typeof data?.detail === "string" ? data.detail
      : res.status === 422 ? "Confira os campos: nome válido, e-mail válido e senha de 8 a 128 caracteres."
      : "Algo deu errado. Tente novamente.";
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return data;
}

export const getConfig = () => request("/api/config/public");

export const getAuthSession = () => request("/api/auth/session", { cache: "no-store" });
export const getShopping = () => request("/api/shopping", { cache: "no-store" });
export const getJson = (path) => request(`/api/${path}`, { cache: "no-store" });
export const getMenu = (restaurant) => request(`/api/menu?restaurant_id=${encodeURIComponent(restaurant.id)}&source=${encodeURIComponent(restaurant.source)}`, { cache: "no-store" });
export const updateShopping = (path, body, csrfToken) => request(`/api/${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  body: JSON.stringify(body),
});
export const authenticate = (action, body, csrfToken) => request(`/api/auth/${action}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  body: JSON.stringify(body),
});

export const sendChat = ({ message, sessionId, location, confirm, csrfToken, signal }) =>
  request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    signal,
    body: JSON.stringify({ message, session_id: sessionId, location: location || null, confirm_pending_action: !!confirm }),
  });

/**
 * Chat em streaming (SSE via fetch, porque é POST). Chama `onEvent(nome, dados)` para cada evento:
 * status, restaurants, delta, done. Um evento `error` do servidor vira exceção.
 * Erros marcados com `fallback = true` indicam que o streaming não está disponível e vale o /api/chat.
 */
export async function streamChat({ message, sessionId, location, confirm, csrfToken, signal }, onEvent) {
  let res;
  try {
    res = await fetch(apiBase() + "/api/chat/stream", {
      method: "POST",
      credentials: "include",
      signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ message, session_id: sessionId, location: location || null, confirm_pending_action: !!confirm }),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Não consegui falar com o servidor. Verifique se o backend está rodando.");
  }
  if (!res.ok || !res.body) {
    let detail = null;
    try { detail = (await res.json())?.detail; } catch { /* sem corpo */ }
    const err = new Error(typeof detail === "string" ? detail : "Algo deu errado. Tente novamente.");
    err.status = res.status;
    err.fallback = [404, 405, 501].includes(res.status) || (res.ok && !res.body);
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block) => {
    let name = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) return;
    const payload = JSON.parse(data.join("\n"));
    if (name === "error") throw new Error(payload.detail || "Algo deu errado. Tente novamente.");
    onEvent(name, payload);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      flush(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
  }
  if (buffer.trim()) flush(buffer);
}

export const geocode = (q) => request(`/api/geocode?q=${encodeURIComponent(q)}`);

export const getWallet = () => request("/api/wallet");
