// Cardápio, prato, sacola e pagamento. O estado do carrinho vem sempre do servidor.
import { getMenu, getShopping, getWallet, updateShopping } from "./api.js";
import { $, money, node, message, newId, imageFor, thumb, fmtKm, pluralItems, openDialog, assetUrl } from "./ui.js";

export function createShopping({ getSession, refreshSession, openLogin, restaurantOrdersEnabled = false, getLocation = () => null, requestLocation = () => {}, onState = () => {}, onPaid = () => {}, onMap = () => {} }) {
  const dialog = $("shopping-dialog");
  const menuDialog = $("menu-dialog");
  const dishDialog = $("dish-dialog");
  const hooks = { getAddress: () => null, openAddress: () => {}, onOrderPlaced: () => {}, openTracking: () => {}, favorites: null };
  const listeners = [];
  let owner = null;
  let generation = 0;
  let state = { items: [] };
  let stateVersion = 0;
  let busy = false;
  let loaded = false;
  let paymentRequestId = null;
  let payMethod = "pix";
  let restaurant = null;
  let dishes = [];
  let menuGeneration = 0;
  let menuLoading = false;
  let dishDraft = null; // { dish, quantity }
  let giftAddressId = null;
  const bagRows = new Map();

  function error(text = "") {
    message("shopping-error", text);
    $("shopping-retry").hidden = !text || !owner;
  }

  const priced = () => state.items.filter((item) => item.unit_price_cents != null);
  const isGift = item => item.restaurant?.source === "gift" && item.restaurant?.id === "foodagent-welcome";
  const giftCart = () => state.items.length === 1 && isGift(state.items[0])
    && (state.gift_checkout_allowed ?? ["welcome-bonbon-lacta-oreo", "welcome-bonbon-serenata-de-amor"].includes(state.items[0].dish_id))
    && state.items[0].quantity === 1 && state.items[0].unit_price_cents === 1000;
  const subtotal = () => priced().reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const coinBalance = () => Number.isSafeInteger(state.wallet?.balance_cents) ? state.wallet.balance_cents : null;
  const missingCoins = () => payMethod === "coins" && coinBalance() !== null ? Math.max(0, subtotal() - coinBalance()) : 0;
  const coins = (cents) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const activeOrders = () => (state.active_orders || []).filter((order) => order.status !== "cancelled" && order.payment_status === "paid" && order.delivery_status === "pending" && order.paid_at != null && order.delivered_at == null);
  const deliveredOrders = () => (state.history || []).filter((order) => order.status !== "cancelled" && order.payment_status === "paid" && order.delivery_status === "delivered" && order.paid_at != null && order.delivered_at != null);

  function stepper(label, onChange) {
    const wrap = node("div", "stepper small");
    wrap.setAttribute("role", "group"); wrap.setAttribute("aria-label", label);
    const minus = node("button", null, "−"); minus.type = "button"; minus.setAttribute("aria-label", `Diminuir ${label}`);
    const plus = node("button", null, "+"); plus.type = "button"; plus.setAttribute("aria-label", `Aumentar ${label}`);
    minus.addEventListener("click", () => onChange(-1));
    plus.addEventListener("click", () => onChange(1));
    wrap.append(minus, node("output"), plus);
    return wrap;
  }

  function bagItem(item) {
    let currentItem = item;
    const row = node("article", "bag-item");
    const text = node("div");
    const controls = stepper(`quantidade de ${item.description}`, (change) => {
      const quantity = currentItem.quantity + change;
      if (quantity > 99) return;
      if (quantity < 1) mutate(`cart/items/${item.id}/remove`, {}, "");
      else mutate(`cart/items/${item.id}/quantity`, { quantity }, "Quantidade atualizada.");
    });
    const remove = node("button", "bag-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remover ${item.description} da sacola`);
    remove.title = "Remover item";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7");
    svg.append(path); remove.append(svg);
    remove.addEventListener("click", () => mutate(`cart/items/${item.id}/remove`, {}, ""));
    const actions = node("div", "bag-item-actions");
    actions.append(controls, remove);
    const image = thumb(item.restaurant.image_url || imageFor(item.description, item.restaurant.category));
    row.append(image, text, actions);
    return { row, update(next) {
      currentItem = next;
      image.querySelector("img").src = assetUrl(next.restaurant.image_url || imageFor(next.description, next.restaurant.category));
      text.replaceChildren(node("h3", null, next.description), node("p", null, next.restaurant.name));
      if (next.note) text.append(node("p", null, `Obs.: ${next.note}`));
      if (!isGift(next) && (next.is_simulated || next.restaurant.is_simulated)) text.append(node("span", "badge", "Demonstração · dados fictícios"));
      if (next.unit_price_cents != null) text.append(node("p", "price", isGift(next) ? `${coins(next.unit_price_cents)} moedas · 1 unidade` : money(next.unit_price_cents * next.quantity)));
      controls.hidden = isGift(next);
      controls.querySelector("output").textContent = String(next.quantity);
    } };
  }

  function renderBag() {
    const list = $("shopping-items");
    const items = owner ? state.items : [];
    const ids = new Set(items.map((item) => item.id));
    for (const [id, entry] of bagRows) {
      if (!ids.has(id)) { entry.row.remove(); bagRows.delete(id); }
    }
    if (!items.length) {
      list.replaceChildren(...(owner ? [node("p", "shopping-empty muted", restaurantOrdersEnabled ? "Sua sacola está vazia. Abra o cardápio de um restaurante e escolha uma comida para adicionar." : "Sua sacola está vazia. O brinde de boas-vindas pode ser resgatado pelo destaque da página inicial.")] : []));
      return;
    }
    list.querySelector(".shopping-empty")?.remove();
    items.forEach((item, index) => {
      if (!bagRows.has(item.id)) bagRows.set(item.id, bagItem(item));
      const entry = bagRows.get(item.id);
      entry.update(item);
      if (list.children[index] !== entry.row) list.insertBefore(entry.row, list.children[index] || null);
    });
  }

  function orderBanner(order) {
    const card = node("article", "order-card");
    const top = node("div", "order-top");
    const info = node("div");
    const total = order.items.some(isGift) ? `${coins(order.total_cents)} moedas` : money(order.total_cents);
    info.append(node("h3", null, order.items[0]?.restaurant?.name || "Pedido"), node("p", null, `${order.items.length} ${pluralItems(order.items.length)} · ${total}`));
    const status = node("div", "order-price");
    status.append(node("small", "going", "Em andamento"));
    top.append(thumb(order.items[0]?.restaurant?.image_url || imageFor(order.items[0]?.description || "", order.items[0]?.restaurant?.category)), info, status);
    const track = node("button", "outline-btn", "Acompanhar pedido");
    track.type = "button";
    track.setAttribute("aria-label", `Acompanhar pedido #${order.id.slice(0, 8)}`);
    track.addEventListener("click", () => hooks.openTracking(order.id));
    card.append(top, track);
    return card;
  }

  function render() {
    const count = state.items.reduce((sum, item) => sum + item.quantity, 0);
    $("cart-count").textContent = String(count);
    $("cart-count").hidden = count === 0;
    $("menu-cart-count").textContent = String(count);
    $("menu-cart-word").textContent = pluralItems(count);
    const total = subtotal();
    $("menu-cart-total").textContent = money(total);
    $("shopping-guest").hidden = !!owner;
    $("shopping-cart").hidden = !owner;
    const active = owner ? activeOrders() : [];
    $("shopping-active").hidden = !active.length;
    $("shopping-active-list").replaceChildren(...active.map(orderBanner));
    renderBag();
    const hasItems = !!owner && state.items.length > 0;
    const gift = giftCart();
    if (gift) payMethod = "coins";
    $("bag-gift-fields").hidden = !gift;
    $("menu-readonly").hidden = restaurantOrdersEnabled;
    $("menu-cart").hidden = !restaurantOrdersEnabled;
    dialog.classList.toggle("bag-empty", !!owner && !hasItems);
    $("bag-checkout").hidden = !hasItems || (!restaurantOrdersEnabled && !gift);
    $("bag-foot").hidden = !hasItems || (!restaurantOrdersEnabled && !gift);
    const address = hooks.getAddress();
    if (gift && (address?.id || null) !== giftAddressId) {
      giftAddressId = address?.id || null;
      $("bag-gift-address").value = address?.line || "";
    }
    $("bag-address-line").textContent = address ? `${address.label} · ${address.line}` : "Escolha o endereço de entrega";
    $("bag-address-change").textContent = address ? "Trocar" : "Escolher";
    $("bag-address-eta").textContent = gift ? "4 min" : "25–35 min";
    dialog.querySelectorAll("[data-pay]").forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset.pay === payMethod));
      option.hidden = gift && option.dataset.pay !== "coins";
    });
    const hasPrices = state.items.every((item) => Number.isSafeInteger(item.unit_price_cents) && item.unit_price_cents >= 0);
    $("bag-subtotal").textContent = hasPrices ? gift ? `${coins(total)} moedas` : money(total) : "—";
    $("bag-total").textContent = hasPrices ? gift ? `${coins(total)} moedas` : money(total) : "Preço indisponível";
    $("bag-coins-balance").textContent = coinBalance() === null ? "Consulte seu saldo ao pagar"
      : `Saldo: ${coins(coinBalance())} moedas · 1 moeda = R$ 1,00`;
    $("shopping-pay-total").textContent = !hasPrices ? "—" : payMethod === "coins"
      ? `${coins(missingCoins() || total)} moedas` : money(total);
    $("shopping-pay-label").textContent = missingCoins() > 0 ? "Recarregar moedas" : "Fazer pedido";
    $("shopping-summary").textContent = hasItems && !address ? "Escolha o endereço de entrega para fazer o pedido."
      : missingCoins() > 0 ? `Faltam ${coins(missingCoins())} moedas para pagar este pedido.` : "";
    dialog.querySelectorAll("button, input, textarea").forEach((control) => { control.disabled = busy && control.id !== "shopping-close"; });
    const canPay = (restaurantOrdersEnabled || gift) && hasItems && loaded && hasPrices && !!address;
    $("shopping-pay").disabled = busy || !canPay;
    $("shopping-pay").setAttribute("aria-label", canPay && missingCoins() > 0 ? "Recarregar moedas para pagar este pedido"
      : canPay ? `Fazer pedido, ${payMethod === "coins" ? `${coins(total)} moedas` : money(total)}` : "Fazer pedido");
    $("dish-add").disabled = !restaurantOrdersEnabled || busy || menuLoading || !owner;
    $("dish-add-label").textContent = restaurantOrdersEnabled ? "Adicionar" : "Compra indisponível";
    dialog.setAttribute("aria-busy", String(busy));
    menuDialog.setAttribute("aria-busy", String(menuLoading));
    listeners.forEach((listener) => listener(state));
  }

  function setSession(session) {
    const next = session?.user?.id || null;
    if (next === owner) return;
    owner = next; generation++; menuGeneration++; busy = false; menuLoading = false;
    loaded = false; paymentRequestId = null; payMethod = "pix";
    giftAddressId = null; $("bag-gift-phone").value = ""; $("bag-gift-address").value = "";
    state = { items: [] }; restaurant = null; dishes = []; dishDraft = null;
    stateVersion++;
    for (const d of [dialog, menuDialog, dishDialog]) if (d.open) d.close();
    $("menu-list").replaceChildren();
    message("shopping-status"); message("menu-status"); message("menu-error"); error(); render();
  }

  function apply(data) {
    if (!Array.isArray(data?.items)) throw new Error("Não foi possível carregar a sacola. Tente novamente.");
    const previousGift = giftCart();
    state = data;
    if (previousGift && !giftCart()) { giftAddressId = null; $("bag-gift-phone").value = ""; $("bag-gift-address").value = ""; }
    stateVersion++;
    if (data.wallet) hooks.onWalletState?.(data.wallet);
    loaded = true;
    onState(data);
  }

  async function refreshWalletForCheckout(current) {
    try {
      const data = await getWallet();
      if (current !== generation) return;
      state = { ...state, wallet: data }; stateVersion++;
      hooks.onWalletState?.(data);
    } catch {
      if (current === generation) state = { ...state, wallet: null };
    }
  }

  function openCoinRecharge() {
    const current = generation;
    dialog.close();
    hooks.openWallet?.({ shortfallCents: missingCoins(), onClose: () => {
      if (current === generation && owner) void open();
    } });
  }

  async function refresh() {
    if (!owner || busy) return;
    const current = generation;
    busy = true; message("shopping-status", "Carregando sacola…"); error(); render();
    try {
      await refreshSession();
      if (current !== generation) return;
      const data = await getShopping();
      if (current !== generation) return;
      apply(data); message("shopping-status");
    } catch (e) { if (current === generation) { loaded = false; message("shopping-status"); error(e.message); } }
    finally { if (current === generation) { busy = false; render(); } }
  }

  /** Envia uma alteração; devolve true quando o servidor aceitou. */
  async function mutate(path, body, text, fromMenu = false, onSuccess = null) {
    if (!restaurantOrdersEnabled && (path === "cart/selections" || path === "cart/items"
      || ((path === "orders" || path === "orders/demo-payment") && !giftCart()))) return false;
    if (busy || !owner) return false;
    const current = generation;
    const currentMenu = menuGeneration;
    const focusedControl = dialog.contains(document.activeElement) ? document.activeElement : null;
    let ok = false;
    busy = true; error(); message("menu-error"); message("dish-error");
    message(fromMenu ? "menu-status" : "shopping-status", fromMenu ? "Atualizando sacola…" : "Atualizando sacola…"); render();
    try {
      await refreshSession();
      if (current !== generation) return false;
      const data = await updateShopping(path, body, getSession().csrf_token);
      if (current !== generation) return false;
      apply(data);
      if (path.startsWith("cart/") || path === "orders/demo-payment") paymentRequestId = null;
      onSuccess?.(data);
      ok = true;
      message("shopping-status", fromMenu ? "" : text);
      message("menu-status", fromMenu && currentMenu === menuGeneration ? text : "");
      if (path === "orders/demo-payment") { dialog.close(); onPaid(data); }
    } catch (e) {
      if (current === generation) {
        message("menu-status"); message("shopping-status");
        if (fromMenu && currentMenu === menuGeneration) { message("menu-error", e.message); message("dish-error", dishDialog.open ? e.message : ""); }
        else error(e.message);
        if (e.status === 402 && path === "orders/demo-payment" && body.payment_method === "coins") {
          await refreshWalletForCheckout(current);
          if (current === generation) openCoinRecharge();
        }
        if (e.status === 409) loaded = false;
      }
    } finally {
      if (current === generation) {
        busy = false; render();
        if (dialog.open && focusedControl?.isConnected && document.activeElement === document.body) focusedControl.focus({ preventScroll: true });
      }
    }
    return ok;
  }

  async function open() {
    for (const d of [menuDialog, dishDialog]) if (d.open) d.close();
    error(); message("shopping-status"); render();
    openDialog(dialog);
    await refresh();
  }

  // ---- prato ----
  function renderDish() {
    const { dish, quantity, note } = dishDraft;
    $("dish-qty").textContent = String(quantity);
    $("dish-add-total").textContent = money(dish.price_cents * quantity);
    $("dish-add").disabled = !restaurantOrdersEnabled || busy || menuLoading || !owner;
    document.querySelectorAll("[data-note]").forEach((chip) => chip.setAttribute("aria-pressed", String(note.split(", ").includes(chip.dataset.note))));
  }

  function openDish(dish) {
    dishDraft = { dish, quantity: 1, note: "" };
    $("dish-name").textContent = dish.name;
    $("dish-restaurant").textContent = restaurant?.name || "";
    $("dish-desc").textContent = dish.description || "";
    $("dish-price").textContent = money(dish.price_cents);
    $("dish-img").src = imageFor(dish.name, restaurant?.category);
    $("dish-note").value = "";
    message("dish-error");
    renderDish();
    openDialog(dishDialog);
  }

  const noteValue = () => $("dish-note").value.trim();
  $("dish-minus").addEventListener("click", () => { if (dishDraft && dishDraft.quantity > 1) { dishDraft.quantity--; renderDish(); } });
  $("dish-plus").addEventListener("click", () => { if (dishDraft && dishDraft.quantity < 99) { dishDraft.quantity++; renderDish(); } });
  document.querySelectorAll("[data-note]").forEach((chip) => chip.addEventListener("click", () => {
    const parts = noteValue() ? noteValue().split(", ") : [];
    const next = parts.includes(chip.dataset.note) ? parts.filter((p) => p !== chip.dataset.note) : [...parts, chip.dataset.note];
    $("dish-note").value = next.join(", ");
    dishDraft.note = $("dish-note").value;
    renderDish();
  }));
  $("dish-note").addEventListener("input", () => { if (dishDraft) { dishDraft.note = noteValue(); renderDish(); } });
  $("dish-close").addEventListener("click", () => dishDialog.close());
  dishDialog.addEventListener("close", () => { dishDraft = null; });
  $("dish-add").addEventListener("click", () => {
    if (!restaurantOrdersEnabled || !dishDraft || !restaurant) return;
    const { dish, quantity } = dishDraft;
    const note = noteValue();
    const body = { restaurant_id: restaurant.id, source: restaurant.source, dish_id: dish.id, quantity };
    if (note) body.note = note;
    mutate("cart/selections", body, `${dish.name} adicionado à sacola.`, true, () => dishDialog.close());
  });

  // ---- restaurante ----
  function paintFavorite() {
    const button = $("menu-fav");
    const available = !!(hooks.favorites && restaurant && restaurant.source === "local_db");
    button.hidden = !available;
    button.setAttribute("aria-pressed", String(available && hooks.favorites.has(restaurant.id)));
  }

  async function syncDeliveries() {
    if (!owner || busy) return null;
    const current = generation;
    const version = stateVersion;
    const data = await getShopping();
    if (current !== generation || version !== stateVersion || busy) return null;
    state = { ...state, orders: data.orders, active_orders: data.active_orders, history: data.history };
    render();
    return data;
  }

  async function openMenu(selected) {
    if (!owner) { openLogin(); return; }
    const current = generation;
    const request = ++menuGeneration;
    restaurant = selected; dishes = []; menuLoading = true;
    $("menu-title").textContent = selected.name;
    $("menu-hero-img").src = assetUrl(selected.image_url || imageFor(selected.name, selected.category));
    const rating = selected.rating != null && selected.review_count ? `★ ${selected.rating.toFixed(1).replace(".", ",")}` : "";
    $("menu-meta").textContent = [rating, selected.cuisine_label, fmtKm(selected.distance_km)].filter(Boolean).join(" · ");
    const chips = restaurantOrdersEnabled ? [node("span", "info-chip ok", "Entrega grátis"), node("span", "info-chip", "25–35 min")] : [node("span", "info-chip", "Apenas para consulta")];
    $("menu-chips").replaceChildren(...chips);
    $("menu-source").textContent = "";
    $("menu-source").hidden = true;
    $("menu-list").replaceChildren();
    $("menu-retry").hidden = true;
    message("menu-status", "Carregando cardápio…"); message("menu-error");
    paintFavorite();
    openDialog(menuDialog);
    render();
    try {
      await refreshSession();
      if (current !== generation || request !== menuGeneration) return;
      const data = await getMenu(selected);
      if (current !== generation || request !== menuGeneration) return;
      if (!Array.isArray(data?.dishes)) throw new Error("Não foi possível carregar o cardápio.");
      dishes = data.dishes;
      // A origem dos preços reais não é mais exibida; só o aviso de cardápio de demonstração (preços fictícios).
      $("menu-source").textContent = data.is_simulated ? data.source_label || "" : "";
      $("menu-source").hidden = !data.is_simulated;
      $("menu-source").classList.toggle("note", !!data.is_simulated);
      const rows = dishes.map((dish) => {
        const row = node("button", "dish-row");
        row.type = "button";
        const info = node("span");
        info.append(node("h3", null, dish.name), node("p", null, dish.description), node("p", "price", money(dish.price_cents)));
        row.append(info);
        if (dish.available) {
          row.append(thumb(imageFor(dish.name, selected.category), restaurantOrdersEnabled ? node("span", "plus", "+") : null));
          row.setAttribute("aria-label", `${restaurantOrdersEnabled ? "Escolher" : "Ver"} ${dish.name}, ${money(dish.price_cents)}`);
          row.addEventListener("click", () => openDish(dish));
        } else {
          row.disabled = true;
          row.append(node("span", "muted", "Indisponível"));
        }
        return row;
      });
      $("menu-list").replaceChildren(...(rows.length ? rows : [node("p", "shopping-empty muted", "Nenhum prato disponível por enquanto.")]));
      message("menu-status");
    } catch (e) {
      if (current === generation && request === menuGeneration) {
        message("menu-status"); message("menu-error", e.message); $("menu-retry").hidden = false;
      }
    } finally { if (current === generation && request === menuGeneration) { menuLoading = false; render(); } }
  }

  /** Espera uma atualização em andamento terminar (ações programáticas não devem ser descartadas). */
  async function whenIdle() {
    for (let i = 0; i < 150 && busy; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  async function reorder(order) {
    if (!restaurantOrdersEnabled) { await open(); return; }
    if (!owner) { openLogin(); return; }
    for (const item of order.items) {
      if (!item.dish_id) continue;
      await whenIdle();
      const ok = await mutate("cart/selections", { restaurant_id: item.restaurant.id, source: item.restaurant.source, dish_id: item.dish_id, quantity: item.quantity }, "", true);
      if (!ok) break;
    }
    await open();
  }

  $("cart-open").addEventListener("click", open);
  $("shopping-close").addEventListener("click", () => dialog.close());
  $("shopping-login").addEventListener("click", () => { dialog.close(); openLogin(); });
  $("shopping-retry").addEventListener("click", refresh);
  $("bag-address-change").addEventListener("click", () => hooks.openAddress());
  dialog.querySelectorAll("[data-pay]").forEach((option) => option.addEventListener("click", () => { payMethod = option.dataset.pay; render(); }));
  $("shopping-pay").addEventListener("click", () => {
    if ((!restaurantOrdersEnabled && !giftCart()) || $("shopping-pay").disabled) return;
    const address = hooks.getAddress();
    if (!address) return;
    if (missingCoins() > 0) { openCoinRecharge(); return; }
    const giftDetails = giftCart() ? { phone: $("bag-gift-phone").value.trim(), delivery_address: $("bag-gift-address").value.trim() } : {};
    if (giftCart() && (!$("bag-gift-address").reportValidity() || !$("bag-gift-phone").reportValidity())) return;
    const destination = Number.isFinite(address.lat) && Number.isFinite(address.lon)
      ? { lat: address.lat, lon: address.lon, label: `${address.label} · ${address.line}`, source: "manual" }
      : getLocation();
    if (!destination) {
      error("Escolha o endereço de entrega para fazer o pedido.");
      hooks.openAddress();
      return;
    }
    paymentRequestId ||= newId();
    mutate("orders/demo-payment", { revision: state.revision, request_id: paymentRequestId, payment_method: payMethod, address_id: address.id, destination, external_maps: true, ...giftDetails },
      "Pedido realizado! Acompanhe a entrega no chat.", false, (data) => {
        dialog.close(); hooks.onOrderPlaced(data.created_order_id);
      });
  });
  $("menu-close").addEventListener("click", () => menuDialog.close());
  menuDialog.addEventListener("close", () => { menuGeneration++; menuLoading = false; restaurant = null; dishes = []; if (dishDialog.open) dishDialog.close(); });
  $("menu-cart").addEventListener("click", open);
  $("menu-retry").addEventListener("click", () => { if (restaurant) openMenu(restaurant); });
  $("menu-fav").addEventListener("click", async () => {
    if (!restaurant || !hooks.favorites) return;
    await hooks.favorites.toggle(restaurant.id);
    paintFavorite();
  });
  render();
  return {
    accept(data) { apply(data); render(); },
    canOrderRestaurants: () => restaurantOrdersEnabled,
    setRestaurantOrdersEnabled(enabled) { restaurantOrdersEnabled = enabled === true; render(); },
    setSession, refresh, syncDeliveries, open, openMenu, reorder, render,
    setHooks: (next) => Object.assign(hooks, next),
    onState: (listener) => listeners.push(listener),
    getState: () => state,
    mutate, whenIdle,
    helpers: { activeOrders, deliveredOrders },
  };
}
