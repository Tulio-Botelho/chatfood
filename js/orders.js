// Acompanhar pedido, histórico, favoritos e perfil.
import { getJson, updateShopping } from "./api.js";
import { $, money, clock, dateLabel, node, imageFor, thumb, openDialog, assetUrl } from "./ui.js";
import { DELIVERY_POLL_SECONDS } from "./delivery-timing.js";

const STEPS = [
  ["Pedido confirmado", "Recebido pelo restaurante"],
  ["Preparando", "Sua comida está sendo feita"],
  ["Saiu para entrega", "O entregador está a caminho"],
  ["Entrega", "Chegou ao endereço"],
];
const PAYMENT = { pix: "Pix", card: "Cartão de crédito", cash: "Dinheiro na entrega", coins: "Moedas FoodAgent" };
const orderPrice = order => order.items.some(item => item.restaurant?.source === "gift")
  ? `${((order.total_cents || 0) / 100).toLocaleString("pt-BR")} moedas` : money(order.total_cents ?? 0);

export function createOrders({ shopping, getSession, refreshSession, openLogin, addresses, onOpenDelivery = null }) {
  const track = $("track-dialog");
  const ordersDialog = $("orders-dialog");
  const profile = $("profile-dialog");
  let owner = null;
  let generation = 0;
  let favorites = [];
  let trackingId = null;
  let ordersTab = "all";
  let ordersMonth = null;
  let timer = null;

  const user = () => getSession()?.user || null;
  const allOrders = () => {
    const state = shopping.getState();
    return [...(state.active_orders || []), ...(state.history || [])];
  };

  // ---- favoritos ----
  const favoriteApi = {
    has: (id) => favorites.some((r) => r.id === id),
    async toggle(id) {
      const current = generation;
      await refreshSession();
      if (current !== generation) return;
      const data = await updateShopping("favorites/toggle", { restaurant_id: id }, getSession().csrf_token);
      if (current === generation) { favorites = data.favorites; renderOrders(); renderProfile(); }
    },
  };
  async function loadFavorites() {
    if (!owner) return;
    const current = generation;
    try {
      const data = await getJson("favorites");
      if (current === generation) { favorites = data.favorites || []; renderOrders(); renderProfile(); }
    } catch { /* os favoritos são opcionais */ }
  }

  // ---- acompanhar pedido ----
  const findOrder = (id) => allOrders().find((order) => order.id === id);

  function renderTrack() {
    const order = trackingId && findOrder(trackingId);
    if (!order) return;
    const tracking = order.tracking || {};
    const simulated = !!tracking.origin;
    const stage = simulated ? ({ preparing: 1, delivering: 2, delivered: 4 }[tracking.stage] ?? 0) : (tracking.stage ?? 0);
    const delivered = order.delivery_status === "delivered";
    const restaurant = order.items[0]?.restaurant?.name || "Restaurante";
    $("track-eta").textContent = delivered ? "Entregue" : simulated ? `${Math.ceil(tracking.remaining_seconds / 60)} min` : stage >= 3 ? "Chegou!" : `${tracking.eta_min ?? 25}–${tracking.eta_max ?? 35} min`;
    $("track-meta").textContent = `Pedido #${order.id.slice(0, 8)} · ${restaurant}`;
    const timeline = simulated ? [tracking.started_at, tracking.started_at, tracking.departure_at, tracking.arrival_at].map((at) => ({ at })) : (tracking.steps || []);
    const steps = timeline.map((step, index) => {
      const li = node("li", delivered || index < stage ? "done" : index === stage ? "now" : "");
      const dot = node("span", "step-dot", "✓");
      dot.setAttribute("aria-hidden", "true");
      const text = node("span", "step-text");
      const reached = delivered || index <= stage;
      text.append(node("strong", null, STEPS[index][0]), node("small", null, reached ? `${STEPS[index][1]} · ${clock(step.at)}` : STEPS[index][1]));
      if (index === stage && !delivered) li.setAttribute("aria-current", "step");
      li.append(dot, text);
      return li;
    });
    $("track-steps").replaceChildren(...steps);
    const summary = $("track-summary");
    summary.className = "bag-card track-summary";
    const text = node("div", "bag-card-text");
    order.items.forEach((item) => text.append(node("strong", null, `${item.quantity}× ${item.description}`)));
    const details = order.details;
    if (details?.address) text.append(node("small", null, `Entrega: ${details.address.label} · ${details.address.line}`));
    if (details) text.append(node("small", null, `Pagamento: ${PAYMENT[details.payment_method] || details.payment_method}`));
    (details?.notes || []).forEach((note) => text.append(node("small", null, `Obs. (${note.description}): ${note.note}`)));
    const total = node("strong", "order-price", orderPrice(order));
    summary.replaceChildren(text, total);
    $("track-received").disabled = delivered || stage < 3;
    $("track-received").textContent = delivered ? "Pedido entregue" : "Recebi meu pedido";
  }

  function stopPolling() { clearInterval(timer); timer = null; }
  function startPolling() {
    stopPolling();
    timer = setInterval(() => {
      if (!track.open) stopPolling();
      else if (!document.hidden) shopping.refresh();
    }, DELIVERY_POLL_SECONDS * 1000);
    timer.unref?.(); // não impede o encerramento de processos de teste
  }

  function openTracking(orderId) {
    const order = orderId && findOrder(orderId);
    if (!order) return;
    if (order.tracking?.origin && onOpenDelivery) {
      if (onOpenDelivery(orderId) !== false) {
        for (const dialog of [track, ordersDialog, profile]) if (dialog.open) dialog.close();
        return;
      }
    }
    trackingId = orderId;
    $("track-error").hidden = true;
    renderTrack();
    ordersDialog.open && ordersDialog.close();
    openDialog(track);
    startPolling();
    shopping.refresh();
  }

  $("track-close").addEventListener("click", () => track.close());
  track.addEventListener("close", () => { stopPolling(); trackingId = null; });
  $("track-received").addEventListener("click", async () => {
    const id = trackingId;
    if (!id) return;
    $("track-error").hidden = true;
    await shopping.whenIdle();
    const ok = await shopping.mutate(`orders/${id}/demo-delivery`, {}, "Entrega confirmada.");
    if (!ok) { $("track-error").textContent = $("shopping-error").textContent || "Não foi possível confirmar a entrega. Tente novamente."; $("track-error").hidden = false; return; }
    track.close();
    openOrders("all");
  });

  // ---- histórico ----
  function orderCard(order, delivered) {
    const card = node("article", "order-card");
    const top = node("div", "order-top");
    const info = node("div");
    const first = order.items[0];
    const names = order.items.map((item) => `${item.quantity}× ${item.description}`).join(", ");
    info.append(node("h3", null, first?.restaurant?.name || "Pedido"), node("p", null, names));
    const price = node("div", "order-price");
    price.append(node("strong", null, orderPrice(order)), node("small", delivered ? "" : "going", delivered ? "Entregue" : "Em andamento"));
    top.append(thumb(first?.restaurant?.image_url || imageFor(first?.description || "")), info, price);
    card.append(top);
    if (delivered) card.append(node("p", "muted", `${dateLabel(order.delivered_at)} · Pedido #${order.id.slice(0, 8)}`));
    if (delivered && !shopping.canOrderRestaurants()) return card;
    const action = node("button", "outline-btn", delivered ? "Pedir de novo" : "Acompanhar pedido");
    action.type = "button";
    action.setAttribute("aria-label", `${delivered ? "Pedir de novo" : "Acompanhar"} o pedido #${order.id.slice(0, 8)}`);
    action.addEventListener("click", () => {
      if (delivered) { ordersDialog.close(); shopping.reorder(order); } else openTracking(order.id);
    });
    card.append(action);
    return card;
  }

  function favoriteCard(restaurant) {
    const card = node("button", "res-card");
    card.type = "button";
    const photo = node("span", "res-photo");
    const img = node("img"); img.src = assetUrl(restaurant.image_url || imageFor(restaurant.name, restaurant.category)); img.alt = ""; photo.append(img);
    const info = node("span", "res-info");
    info.append(node("h3", null, restaurant.name), node("small", null, restaurant.cuisine_label || restaurant.address || ""));
    card.append(photo, info);
    card.addEventListener("click", () => { ordersDialog.close(); shopping.openMenu({ ...restaurant, source: restaurant.source || "local_db" }); });
    return card;
  }

  const monthKey = (seconds) => { const d = new Date(seconds * 1000); return d.getFullYear() * 12 + d.getMonth(); };
  const monthDate = (key) => new Date(Math.floor(key / 12), key % 12, 1);
  const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const monthLong = (key) => cap(monthDate(key).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const monthShort = (key) => cap(monthDate(key).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")) + " " + monthDate(key).getFullYear();
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  function renderOrders() {
    const state = shopping.helpers;
    const delivered = state.deliveredOrders();
    const active = state.activeOrders();
    const keys = [...new Set(delivered.map((order) => monthKey(order.delivered_at)))].sort((a, b) => b - a);
    if (ordersMonth == null || !keys.includes(ordersMonth)) ordersMonth = keys[0] ?? null;
    const counts = { all: delivered.length + active.length, month: keys.length, fav: favorites.length };
    document.querySelectorAll("[data-orders-tab]").forEach((tab) => {
      const on = tab.dataset.ordersTab === ordersTab;
      tab.setAttribute("aria-pressed", String(on)); tab.setAttribute("aria-selected", String(on));
      const badge = tab.querySelector("[data-count]");
      if (badge) { badge.textContent = String(counts[tab.dataset.ordersTab]); badge.hidden = !counts[tab.dataset.ordersTab]; }
    });

    // meses com pedidos entregues
    const months = $("orders-months");
    months.hidden = ordersTab !== "month" || !keys.length;
    months.replaceChildren(...keys.map((key) => {
      const chip = node("button", "pick-chip", monthShort(key));
      chip.type = "button"; chip.setAttribute("aria-pressed", String(key === ordersMonth));
      chip.setAttribute("aria-label", monthLong(key));
      chip.addEventListener("click", () => { ordersMonth = key; renderOrders(); });
      return chip;
    }));

    let nodes = [];
    let summary = "";
    if (ordersTab === "fav") {
      nodes = favorites.map(favoriteCard);
      if (!nodes.length) nodes = [node("p", "shopping-empty muted", "Você ainda não favoritou restaurantes. Toque no coração dentro do cardápio.")];
      else summary = plural(favorites.length, "restaurante favorito", "restaurantes favoritos");
    } else if (ordersTab === "month") {
      const list = delivered.filter((order) => monthKey(order.delivered_at) === ordersMonth);
      nodes = list.map((order) => orderCard(order, true));
      if (!nodes.length) nodes = [node("p", "shopping-empty muted", "Nenhum pedido entregue ainda.")];
      else summary = `${monthLong(ordersMonth)} · ${plural(list.length, "pedido", "pedidos")} · ${money(list.reduce((sum, order) => sum + (order.total_cents ?? 0), 0))}`;
    } else {
      nodes = [...active.map((order) => orderCard(order, false)), ...delivered.map((order) => orderCard(order, true))];
      if (!nodes.length) nodes = [node("p", "shopping-empty muted", "Você ainda não fez pedidos.")];
      else summary = `${plural(delivered.length, "pedido entregue", "pedidos entregues")}${active.length ? ` · ${active.length} em andamento` : ""}`;
    }
    $("orders-summary").hidden = !summary;
    $("orders-summary").textContent = summary;
    $("orders-list").replaceChildren(...nodes);
  }

  function openOrders(tab = "all") {
    if (!user()) { openLogin(); return; }
    ordersTab = tab;
    renderOrders();
    if (profile.open) profile.close();
    openDialog(ordersDialog);
    shopping.refresh();
    loadFavorites();
  }
  document.querySelectorAll("[data-orders-tab]").forEach((chip) => chip.addEventListener("click", () => { ordersTab = chip.dataset.ordersTab; renderOrders(); }));
  $("orders-close").addEventListener("click", () => ordersDialog.close());

  // ---- perfil ----
  function initials(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() : "👤";
  }
  function renderProfile() {
    const current = user();
    $("profile-avatar").textContent = initials(current?.name);
    $("profile-name").textContent = current?.name || "";
    $("profile-email").textContent = current?.email || "";
    const count = addresses.list().length;
    $("profile-addresses-sub").textContent = count ? `${count} ${count === 1 ? "salvo" : "salvos"}` : "";
    $("profile-fav-all").hidden = favorites.length === 0;
    const items = favorites.slice(0, 3).map((restaurant) => {
      const item = node("button", "fav-item");
      item.type = "button";
      item.append(thumb(restaurant.image_url || imageFor(restaurant.name, restaurant.category)), node("span", null, restaurant.name));
      item.addEventListener("click", () => { profile.close(); shopping.openMenu({ ...restaurant, source: restaurant.source || "local_db" }); });
      return item;
    });
    $("profile-favs").replaceChildren(...(items.length ? items : [node("p", "muted", "Seus restaurantes favoritos aparecem aqui.")]));
  }
  function openProfile() {
    if (!user()) { openLogin(); return; }
    renderProfile();
    openDialog(profile);
    loadFavorites();
    addresses.load().then(renderProfile);
  }
  $("profile-open").addEventListener("click", openProfile);
  document.querySelectorAll("[data-open-orders]").forEach((button) => button.addEventListener("click", () => openOrders(button.dataset.openOrders)));
  $("profile-close").addEventListener("click", () => profile.close());
  $("profile-fav-all").addEventListener("click", () => openOrders("fav"));
  $("profile-addresses").addEventListener("click", () => addresses.open());
  $("profile-settings").addEventListener("click", () => { profile.close(); $("settings-open").click(); });
  $("profile-logout").addEventListener("click", () => { profile.close(); $("auth-logout").click(); });

  shopping.setHooks({ favorites: favoriteApi, openTracking });
  shopping.onState(() => { if (track.open) renderTrack(); if (ordersDialog.open) renderOrders(); });

  return {
    openTracking, openOrders, openProfile, loadFavorites,
    setSession(session) {
      const next = session?.user?.id || null;
      if (next === owner) return;
      owner = next; generation++; favorites = []; trackingId = null; stopPolling();
      for (const d of [track, ordersDialog, profile]) if (d.open) d.close();
      if (next) loadFavorites();
    },
  };
}
