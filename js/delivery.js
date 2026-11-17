import { buildDeliveryMap } from "./delivery-map.js";
import { openDialog } from "./ui.js";
import { DELIVERY_POLL_SECONDS } from "./delivery-timing.js";

const STAGES = ["confirmed", "preparing", "delivering", "delivered"];
const LABELS = ["Confirmado", "Preparando", "Entregador a caminho", "Entregue"];
const ICONS = [
  "M5 12l4 4L19 6",
  "M5 11h14v5a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-5ZM3 11H1m18 0h4M8 7c-2-2 2-2 0-4m4 4c-2-2 2-2 0-4m4 4c-2-2 2-2 0-4",
  "M7 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm16 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 17l5-7h5l-4 7H4Zm6 0h7M8 7h5m1-4h3l3 14",
  "M6 7h12l2 14H4L6 7Zm3 0V5a3 3 0 0 1 6 0v2m-7 7 3 3 5-5",
];
const el = (tag, className, text) => {
  const node = document.createElement(tag); node.className = className || "";
  if (text != null) node.textContent = text;
  return node;
};
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function deliveryView(tracking, elapsedSeconds = 0) {
  // Só interpola até o próximo evento. Etapas e conclusão vêm da API.
  const stage = tracking.stage;
  const nextBoundary = stage === "preparing" ? tracking.departure_at : stage === "delivering" ? tracking.arrival_at : tracking.server_now;
  const now = Math.min(tracking.server_now + Math.max(0, elapsedSeconds), nextBoundary);
  const travelSeconds = Math.max(1, tracking.arrival_at - tracking.departure_at);
  return { stage, remaining: stage === "delivered" ? 0 : Math.max(0, Math.ceil(tracking.arrival_at - now)),
    progress: stage === "delivered" ? 1 : stage === "preparing" ? 0 : Math.min(.999, Math.max(0, (now - tracking.departure_at) / travelSeconds)) };
}

export function createDelivery({ chat, notify, refresh, onUnauthorized = () => {},
  isVisible = () => true, onOrders = () => {}, onOpenOrder = () => {} }) {
  const dialog = document.getElementById("delivery-map-dialog");
  const status = document.getElementById("delivery-map-status");
  const container = document.getElementById("delivery-map");
  const cards = new Map();
  const inlineMaps = new Map();
  const homeCards = new Map();
  const homeSection = document.getElementById("home-active-orders");
  const homeList = document.getElementById("home-active-orders-list");
  let owner = null, orders = [], receivedAt = 0, timer = null, polling = false;
  let map = null, mapOrder = null, mapGeneration = 0;
  let seen = new Set();
  let stale = false;
  const storageKey = () => "foodagent.delivery-events.v1." + owner;
  const storage = () => { try { return window.localStorage; } catch { return null; } };

  function closeMap() {
    mapGeneration++; map?.destroy(); map = null; mapOrder = null;
    container.replaceChildren();
  }
  function removeInlineMap(id) {
    const entry = inlineMaps.get(id);
    inlineMaps.delete(id);
    entry?.map?.destroy();
  }

  async function mountInlineMap(order, row) {
    const entry = { row, map: null };
    inlineMaps.set(order.id, entry);
    const canvas = row.querySelector(".delivery-inline-map");
    const caption = row.querySelector(".delivery-inline-status");
    const current = () => inlineMaps.get(order.id) === entry && row.isConnected;
    canvas.addEventListener("maptileserror", () => {
      if (current()) caption.textContent = "Não foi possível carregar o fundo do mapa. A rota e o acompanhamento continuam disponíveis.";
    });
    try {
      const result = await buildDeliveryMap(canvas, order.tracking);
      if (!current()) { result?.destroy(); return; }
      entry.map = result;
      caption.textContent = order.tracking.external_maps ? (order.tracking.route.status === "ready" ? "Trajeto do restaurante até o destino" : order.tracking.route.reason) : "Origem e destino da entrega";
      tick();
    } catch (e) {
      if (!current()) return;
      // Mantém origem e destino visíveis mesmo quando o mapa externo não carrega.
      canvas.replaceChildren();
      const result = await buildDeliveryMap(canvas, { ...order.tracking, external_maps: false });
      if (!current()) { result?.destroy(); return; }
      entry.map = result;
      caption.textContent = e.message;
    }
  }
  function setSession(session) {
    const next = session?.user?.id || null;
    if (next === owner) return;
    if (timer) clearInterval(timer); timer = null;
    owner = next; orders = []; stale = false; polling = false;
    for (const id of inlineMaps.keys()) removeInlineMap(id);
    cards.forEach((row) => row.remove()); cards.clear();
    homeCards.clear(); homeList?.replaceChildren();
    if (homeSection) homeSection.hidden = true;
    if (dialog.open) dialog.close(); else closeMap();
    try { seen = new Set(JSON.parse(storage()?.getItem(storageKey()) || "[]")); } catch { seen = new Set(); }
  }

  function card(order) {
    const t = order.tracking;
    const card = el("article", "delivery-card");
    card.dataset.orderId = order.id;
    const top = el("div", "delivery-card-top");
    top.append(el("strong", null, `Pedido #${order.id.slice(0, 8)}`));
    const steps = el("ol", "delivery-steps");
    STAGES.forEach((name, index) => {
      const step = el("li", "delivery-step"); step.dataset.stage = name;
      const icon = el("span", "delivery-step-icon"); icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.7");
      svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", ICONS[index]); svg.append(path); icon.append(svg);
      step.append(icon, el("span", "delivery-step-label", LABELS[index])); steps.append(step);
    });
    const eta = el("p", "delivery-eta"); eta.setAttribute("aria-live", "off");
    const inlineMap = el("div", "delivery-map delivery-inline-map");
    inlineMap.setAttribute("role", "region");
    inlineMap.setAttribute("aria-label", `Mapa do pedido #${order.id.slice(0, 8)}`);
    const caption = el("p", "delivery-map-status delivery-inline-status muted", "Carregando mapa…");
    caption.setAttribute("role", "status");
    card.append(top, el("p", "delivery-origin", t.origin.name + (t.origin.is_simulated && t.origin.source !== "gift" ? " · restaurante fictício" : "")), steps, eta, inlineMap, caption);
    const row = chat.addAgent(""); row.classList.add("delivery-message");
    row.querySelector(".bubble").append(card);
    return row;
  }

  function render() {
    const visible = new Set(orders.filter(isVisible).map((order) => order.id));
    for (const [id, row] of cards) if (!visible.has(id)) { removeInlineMap(id); row.remove(); cards.delete(id); }
    for (const order of orders) {
      if (!visible.has(order.id)) continue;
      if (!cards.get(order.id)?.isConnected) {
        removeInlineMap(order.id);
        const row = card(order);
        cards.set(order.id, row);
        mountInlineMap(order, row);
      }
    }
    renderHome();
    tick();
  }

  function renderHome() {
    if (!homeSection || !homeList) return;
    const active = orders.filter((order) => order.tracking.stage !== "delivered");
    const ids = new Set(active.map((order) => order.id));
    for (const [id, card] of homeCards) if (!ids.has(id)) { card.remove(); homeCards.delete(id); }
    homeSection.hidden = active.length === 0;
    for (const order of active) {
      if (homeCards.has(order.id)) continue;
      const button = el("button", "active-order-card"); button.type = "button"; button.dataset.orderId = order.id;
      const copy = el("span", "active-order-copy");
      copy.append(el("strong", null, order.tracking.origin.name), el("span", "active-order-status"), el("span", "active-order-link", "Acompanhar pedido"));
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrow.classList.add("active-order-chevron"); arrow.setAttribute("viewBox", "0 0 24 24");
      arrow.setAttribute("aria-hidden", "true"); arrow.setAttribute("fill", "none"); arrow.setAttribute("stroke", "currentColor"); arrow.setAttribute("stroke-width", "2");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "m9 5 7 7-7 7"); arrow.append(path);
      const symbol = el("span", "active-order-symbol", "🛵"); symbol.setAttribute("aria-hidden", "true");
      button.append(symbol, copy, arrow);
      button.addEventListener("click", () => onOpenOrder(order.id));
      homeCards.set(order.id, button); homeList.append(button);
    }
  }

  function tick() {
    const elapsed = (performance.now() - receivedAt) / 1000;
    for (const order of orders) {
      const view = deliveryView(order.tracking, elapsed);
      const current = STAGES.indexOf(view.stage);
      const homeCard = homeCards.get(order.id);
      if (homeCard) {
        const text = stale ? "Atualizando acompanhamento…" : `${LABELS[current]} · faltam ${clock(view.remaining)}`;
        homeCard.querySelector(".active-order-status").textContent = text;
        homeCard.setAttribute("aria-label", `Acompanhar pedido de ${order.tracking.origin.name}: ${text}`);
      }
      const row = cards.get(order.id); if (!row) continue;
      row.querySelectorAll(".delivery-step").forEach((step, index) => {
        step.classList.toggle("done", index < current); step.classList.toggle("current", index === current);
        if (index === current) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
      });
      row.querySelector(".delivery-eta").textContent = stale ? "Sem atualização do servidor. Tentando novamente…" : view.stage === "delivered" ? "Entregue. Bom apetite!" : `${LABELS[current]} · faltam ${clock(view.remaining)}`;
      inlineMaps.get(order.id)?.map?.update(view.progress);
      if (mapOrder === order.id) {
        map?.update(view.progress);
        document.getElementById("delivery-map-eta").textContent = row.querySelector(".delivery-eta").textContent;
      }
    }
  }

  function accept(data) {
    if (!owner) return;
    const tracked = (data.orders || [...(data.active_orders || []), ...(data.history || [])]).filter((order) => order.tracking?.origin && order.status !== "cancelled");
    const active = tracked.filter((order) => order.tracking.stage !== "delivered");
    // Concluídos recentes reaparecem após recarga; os antigos ficam no histórico.
    const visible = tracked.filter((order) => order.tracking.stage !== "delivered" || order.tracking.server_now - order.delivered_at < 3600 || cards.has(order.id));
    const ids = new Set(visible.map((order) => order.id));
    for (const [id, row] of cards) if (!ids.has(id)) { removeInlineMap(id); row.remove(); cards.delete(id); }
    if (mapOrder && !ids.has(mapOrder)) dialog.close();
    orders = visible; receivedAt = performance.now(); stale = false;
    onOrders(orders);
    for (const order of visible) {
      const events = order.tracking.events || [];
      const unseen = events.filter((event) => !seen.has(event.id));
      // Ao voltar, informa só o estado mais recente e descarta avisos superados.
      const announce = unseen.slice(-1);
      for (const event of announce) {
        // Outra aba pode já ter recebido o evento.
        try { if (JSON.parse(storage()?.getItem(storageKey()) || "[]").includes(event.id)) continue; } catch { /* memória local */ }
        notify(`${event.message} (Pedido #${order.id.slice(0, 8)})`, event.id, order);
      }
      events.forEach((event) => seen.add(event.id));
    }
    try { storage()?.setItem(storageKey(), JSON.stringify([...seen].slice(-1000))); } catch { /* continua na sessão */ }
    render();
    if (active.length && !timer) {
      let seconds = 0;
      timer = setInterval(() => { tick(); if (++seconds % DELIVERY_POLL_SECONDS === 0 && !document.hidden) poll(); }, 1000);
      timer.unref?.();
    } else if (!active.length && timer) { clearInterval(timer); timer = null; }
  }

  async function poll() {
    if (polling || !owner) return;
    const account = owner;
    polling = true;
    try {
      const data = await refresh();
      if (account !== owner || !data) return;
      accept(data);
      if (map) status.textContent = mapDescription(orders.find((order) => order.id === mapOrder)?.tracking);
    } catch (e) {
      if (account !== owner) return;
      stale = true;
      if (e.status === 401) onUnauthorized();
      status.textContent = "Sem atualização do servidor. Tentaremos novamente; os horários do pedido estão salvos.";
      for (const row of cards.values()) row.querySelector(".delivery-eta").textContent = "Sem atualização do servidor. Tentando novamente…";
      tick();
    } finally { if (account === owner) polling = false; }
  }

  async function query() {
    const account = owner;
    await poll();
    if (!account || account !== owner) return;
    const text = stale ? "Não consegui atualizar sua entrega. Os horários estão salvos e tentarei novamente."
      : orders.length ? orders.map((order) => {
        const view = deliveryView(order.tracking);
        return `Pedido #${order.id.slice(0, 8)}: ${LABELS[STAGES.indexOf(view.stage)]}${view.remaining ? `, faltam ${clock(view.remaining)}` : ""}.`;
      }).join(" ") : "Você ainda não tem uma entrega em acompanhamento. Abra a sacola para consultar seus pedidos.";
    chat.addAgent(text);
  }

  function mapDescription(t) {
    if (!t) return "";
    if (t.origin?.source === "gift") return t.route.status === "ready" ? "Acompanhe o trajeto do entregador até o seu endereço." : t.route.reason;
    return t.route.status === "ready" ? "Trajeto pelas ruas até o endereço de entrega." : t.route.reason;
  }

  async function openMap(id) {
    closeMap();
    const order = orders.find((order) => order.id === id); if (!order) return;
    mapOrder = id;
    const current = ++mapGeneration;
    document.getElementById("delivery-map-title").textContent = `${order.tracking.origin.source === "gift" ? "Entrega do brinde" : "Entrega do pedido"} · #${id.slice(0, 8)}`;
    document.getElementById("delivery-map-address").textContent = `${order.tracking.origin.name} → ${order.tracking.destination.label || "Destino confirmado"}`;
    status.textContent = "Carregando mapa…";
    document.getElementById("delivery-map-retry").hidden = true;
    openDialog(dialog);
    const canvas = el("div", "delivery-map-canvas"); container.append(canvas);
    try {
      const result = await buildDeliveryMap(canvas, order.tracking);
      if (current !== mapGeneration) { result?.destroy(); return; }
      map = result; status.textContent = mapDescription(order.tracking); tick();
    } catch (e) {
      if (current !== mapGeneration) return;
      status.textContent = e.message; document.getElementById("delivery-map-retry").hidden = false;
    }
  }
  container.addEventListener("maptileserror", () => { status.textContent = "Não foi possível carregar o mapa de fundo. A rota e os horários continuam disponíveis."; });
  dialog.addEventListener("close", closeMap);
  document.getElementById("delivery-map-close").addEventListener("click", () => dialog.close());
  document.getElementById("delivery-map-retry").addEventListener("click", () => openMap(mapOrder));
  document.getElementById("delivery-map-expand").addEventListener("click", () => {
    dialog.classList.toggle("expanded"); map?.resize();
    document.getElementById("delivery-map-expand").textContent = dialog.classList.contains("expanded") ? "Reduzir mapa" : "Ampliar mapa";
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && orders.length) poll(); });
  window.addEventListener("online", () => { if (orders.length) poll(); });
  return { setSession, accept, render, openMap, refresh: poll, query, getOrder: (id) => orders.find((order) => order.id === id) };
}
