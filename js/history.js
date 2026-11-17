// Histórico de conversas guardado no navegador (localStorage), separado por usuário.
// Os dados ficam só neste aparelho: não vão ao servidor nem a outros dispositivos.
const PREFIX = "foodagent.history.v1.";
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES = 200;
const MAX_TEXT = 4000;
const MAX_PANEL_BYTES = 60000;

function browserStorage() {
  try { return globalThis.localStorage || globalThis.window?.localStorage || null; } catch { return null; }
}

export function createHistory() {
  let userKey = "guest";
  const fallback = new Map(); // quando o localStorage está indisponível (modo privado etc.)
  const listeners = new Set();
  const keyName = () => PREFIX + userKey;

  function read() {
    let raw = null;
    try { raw = browserStorage()?.getItem(keyName()) ?? fallback.get(keyName()) ?? null; } catch { raw = fallback.get(keyName()) ?? null; }
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages)) : [];
    } catch { return []; }
  }

  function write(list) {
    const attempt = (items) => {
      const json = JSON.stringify(items);
      fallback.set(keyName(), json);
      browserStorage()?.setItem(keyName(), json);
    };
    try { attempt(list); }
    catch {
      // Cota cheia: descarta a metade mais antiga e tenta de novo.
      try { attempt(list.slice(0, Math.ceil(list.length / 2))); } catch { /* mantém só em memória */ }
    }
    listeners.forEach((fn) => fn());
  }

  const plain = (text) => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const sorted = (list) => [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  const titleFrom = (text) => {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 60 ? `${t.slice(0, 57)}…` : t || "Nova conversa";
  };

  return {
    /** Troca o dono do histórico. Retorna true se o usuário mudou. */
    setUser(user) {
      const next = user?.id ? `u.${user.id}` : "guest";
      const changed = next !== userKey;
      userKey = next;
      if (changed) listeners.forEach((fn) => fn());
      return changed;
    },
    onChange(fn) { listeners.add(fn); },
    /** Conversas mais recentes primeiro. Com `query`, só as que citam o termo no título ou nas mensagens. */
    list(query = "") {
      const term = plain(query);
      const all = sorted(read());
      const found = term ? all.filter((c) => plain(c.title).includes(term) || c.messages.some((m) => plain(m.text || "").includes(term))) : all;
      return found.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    },
    get(id) { return read().find((c) => c.id === id) || null; },
    findOrderConversation(orderId) {
      return read().find((c) => c.orderIds?.includes(orderId)
        || c.messages.some((message) => message.eventId?.startsWith(`${orderId}:`))) || null;
    },
    attachOrder(id, orderId, title = "Acompanhar pedido") {
      const list = read();
      let conv = list.find((c) => c.id === id);
      if (!conv) {
        conv = { id, title, updatedAt: Date.now(), messages: [], panel: null };
        list.push(conv);
      }
      if (conv.orderIds?.includes(orderId)) return;
      conv.orderIds = [...(conv.orderIds || []), orderId];
      write(sorted(list).slice(0, MAX_CONVERSATIONS));
    },
    addMessage(id, role, text, tag = null, eventId = null) {
      if (!id || !text) return;
      const list = read();
      if (eventId && list.some((conv) => conv.messages.some((message) => message.eventId === eventId))) return;
      let conv = list.find((c) => c.id === id);
      if (!conv) {
        conv = { id, title: role === "user" ? titleFrom(text) : "Nova conversa", updatedAt: Date.now(), messages: [], panel: null };
        list.push(conv);
      } else if (conv.title === "Nova conversa" && role === "user") {
        conv.title = titleFrom(text);
      }
      const message = { role, text: String(text).slice(0, MAX_TEXT) };
      if (tag) message.tag = String(tag).slice(0, 200);
      if (eventId) message.eventId = eventId;
      conv.messages.push(message);
      if (conv.messages.length > MAX_MESSAGES) conv.messages.splice(0, conv.messages.length - MAX_MESSAGES);
      conv.updatedAt = Date.now();
      write(sorted(list).slice(0, MAX_CONVERSATIONS));
    },
    /** Guarda o último resultado do painel de restaurantes, para reabri-lo ao voltar à conversa. */
    setPanel(id, data) {
      const list = read();
      const conv = list.find((c) => c.id === id);
      if (!conv) return;
      let json = "";
      try { json = JSON.stringify(data); } catch { return; }
      conv.panel = json.length <= MAX_PANEL_BYTES ? JSON.parse(json) : null;
      write(list);
    },
    remove(id) { write(read().filter((c) => c.id !== id)); },
    clear() { write([]); },
  };
}
