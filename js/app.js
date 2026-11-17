import { getConfig, sendChat, streamChat } from "./api.js";
import { createChat } from "./chat.js";
import { LOCATION_ERRORS, getLocation, onLocationChange, requestBrowserLocation, setLocation } from "./location.js";
import { createPanel } from "./restaurants.js";
import { initAuth } from "./auth.js";
import { createShopping } from "./shopping.js";
import { createWallet } from "./wallet.js";
import { createGifts } from "./gifts.js";
import { createHistory } from "./history.js";
import { createSidebar } from "./sidebar.js";
import { createHome } from "./home.js";
import { initTheme } from "./theme.js";
import { createAddresses } from "./addresses.js";
import { createOrders } from "./orders.js";
import { createDelivery } from "./delivery.js";

const $ = (id) => document.getElementById(id);

const newSessionId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, "");

export async function initApp() {
  initTheme();
  let sessionId = newSessionId();
  let authSession = null;
  let auth = null;
  const wallet = createWallet({ openLogin: () => auth.open() });
  const addresses = createAddresses({
    getSession: () => authSession, refreshSession: () => auth.ensureSession(),
    onConfirm: (loc, ownerId) => applyLocation(loc, ownerId), onAuthError: () => authFailure(),
  });
  const gifts = createGifts({ getSession: () => authSession, refreshSession: () => auth.ensureSession(),
    openLogin: () => auth.open(), wallet,
    openBag: async data => { if (data) shopping.accept(data); await shopping.open(); },
    openTracking: async id => { await shopping.refresh(); orders.openTracking(id); } });
  const chat = createChat({ messages: $("messages"), welcome: $("welcome") });
  const delivery = createDelivery({ chat,
    notify: (text, eventId, order) => {
      const conversationId = ensureOrderConversation(order);
      history.addMessage(conversationId, "agent", text, null, eventId);
      if (conversationId === sessionId) chat.addAgent(text);
    },
    isVisible: (order) => history.findOrderConversation(order.id)?.id === sessionId,
    onOrders: (list) => list.forEach(ensureOrderConversation),
    onOpenOrder: (id) => openDeliveryConversation(id),
    refresh: () => shopping.syncDeliveries(), onUnauthorized: () => auth?.refreshSession().catch(() => {}),
  });
  const shopping = createShopping({ getSession: () => authSession, refreshSession: () => auth.ensureSession(), openLogin: () => auth.open(),
    getLocation, requestLocation, onState: (data) => {
      if (data.created_order_id) history.attachOrder(sessionId, data.created_order_id);
      if (data.created_order_id) void gifts.refresh();
      delivery.accept(data);
    }, onPaid: () => delivery.render(), onMap: (id) => delivery.openMap(id),
  });
  const orders = createOrders({
    shopping, getSession: () => authSession, refreshSession: () => auth.ensureSession(),
    openLogin: () => auth.open(), addresses, onOpenDelivery: (id) => openDeliveryConversation(id),
  });
  shopping.setHooks({
    getAddress: () => addresses.selected(),
    openAddress: () => addresses.open(),
    openWallet: (options) => wallet.open(options),
    onWalletState: (data) => wallet.accept(data),
    onOrderPlaced: (id) => { panel.close(); orders.openTracking(id); },
  });
  const panel = createPanel({
    app: $("app"), panel: $("panel"), title: $("panel-title"), sub: $("panel-sub"),
    notes: $("panel-notes"), list: $("panel-list"), foot: $("panel-foot"), closeBtn: $("panel-close"),
    summary: $("res-summary"), chips: $("res-chips"),
    onSelect: (restaurant) => shopping.openMenu(restaurant),
    onEdit: (text) => { input.value = text; input.focus(); },
  });
  const dialog = $("loc-dialog");
  const input = $("input");
  const sendBtn = $("send");
  let busy = false;
  let pending = null; // mensagem aguardando login completo e localização
  let config = { agent_mode: "adk", demo_locations: [] };
  let locationRequested = false;
  let locationCard = null;
  let generation = 0;
  let activeController = null;
  let lastQuery = "";

  const history = createHistory();
  const sidebar = createSidebar({
    app: $("app"), history,
    getActive: () => sessionId,
    onNewChat: () => startNewChat(true),
    onSelect: (id) => openConversation(id),
    onDelete: (id) => { history.remove(id); if (id === sessionId) startNewChat(true); },
  });
  history.onChange(() => sidebar.render());
  const home = createHome({ app: $("app"), welcome: $("welcome"), input });

  function resetConversation(id) {
    generation++;
    activeController?.abort(); activeController = null;
    busy = false; sendBtn.disabled = false;
    sessionId = id;
    pending = null;
    locationRequested = false;
    locationCard = null;
    chat.clear(); panel.clear();
  }

  function startNewChat(force = false) {
    if (busy && !force) return;
    resetConversation(newSessionId());
    input.value = "";
    delivery.render();
    sidebar.render();
    input.focus();
  }

  function openConversation(id, { force = false } = {}) {
    if (busy && !force) return;
    const conversation = history.get(id);
    if (!conversation) return;
    resetConversation(id);
    for (const message of conversation.messages) {
      if (message.role === "user") chat.addUser(message.text);
      else chat.addAgent(message.text, message.tag === "Entrega simulada" ? null : message.tag);
    }
    delivery.render();
    if (conversation.panel && !sidebar.isMobile()) panel.open(conversation.panel);
    sidebar.render();
  }

  function ensureOrderConversation(order) {
    const existing = history.findOrderConversation(order.id);
    if (existing) return existing.id;
    const id = newSessionId();
    history.attachOrder(id, order.id, `Pedido em ${order.tracking.origin.name}`);
    return id;
  }

  function openDeliveryConversation(orderId) {
    const order = delivery.getOrder(orderId);
    if (!order) return false;
    const id = ensureOrderConversation(order);
    for (const dialogId of ["shopping-dialog", "track-dialog", "orders-dialog", "profile-dialog"]) {
      if ($(dialogId).open) $(dialogId).close();
    }
    if (id !== sessionId || !$("welcome").hidden) openConversation(id, { force: true });
    else delivery.render();
    panel.close();
    document.querySelectorAll(".delivery-card").forEach((card) => {
      if (card.dataset.orderId === orderId) card.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
    return true;
  }

  function updateAccessHint() {
    const hint = $("access-hint");
    hint.hidden = !!(authSession?.user && getLocation());
    hint.textContent = !authSession?.user
      ? authSession?.email_challenge?.purpose === "login"
        ? "Confirme o código recebido por e-mail para concluir o login."
        : "Entre na sua conta para buscar restaurantes. Sua mensagem será preservada."
      : "Defina sua localização pelo navegador ou informe um endereço para continuar.";
  }

  // Ao entrar na conta já pede a localização, para não interromper a primeira busca depois.
  function askLocationOnEntry() {
    const scheduledGeneration = generation;
    const ask = async () => {
      if (scheduledGeneration !== generation || !authSession?.user || getLocation() || dialog.open) return;
      const ownerId = authSession.user.id;
      await addresses.load();
      if (scheduledGeneration !== generation || getLocation() || authSession?.user?.id !== ownerId) return;
      const saved = addresses.selected();
      if (saved) applyLocation(addresses.asLocation(saved), ownerId);
      else openLocationDialog();
    };
    setTimeout(() => {
      const authDialog = $("auth-dialog");
      if (authDialog.open) authDialog.addEventListener("close", () => setTimeout(ask, 0), { once: true });
      else ask();
    }, 0);
  }

  function onSessionChange(data, reason) {
    const previousUser = authSession?.user?.id || null;
    authSession = data;
    shopping.setSession(data);
    orders.setSession(data);
    addresses.setOwner(data.user?.id || null);
    delivery.setSession(data);
    wallet.setSession(data);
    gifts.setSession(data);
    history.setUser(data.user);
    sidebar.setUser(data.user);
    const currentUser = data.user?.id || null;
    if (auth && currentUser && previousUser !== currentUser) shopping.refresh();
    if (previousUser !== currentUser) {
      generation++;
      activeController?.abort(); activeController = null;
      busy = false; sendBtn.disabled = false;
      sessionId = newSessionId();
      chat.clear(); panel.clear();
      locationCard = null;
      setLocation(null);
      if (dialog.open) dialog.close();
      $("loc-address").value = "";
      if (pending?.confirm || (currentUser && pending?.ownerId && pending.ownerId !== currentUser)) {
        pending = null; input.value = ""; locationRequested = false;
      } else if (previousUser && !pending) {
        input.value = ""; locationRequested = false;
      }
    }
    if (reason === "logout") {
      pending = null; locationRequested = false; input.value = "";
    }
    sidebar.render();
    updateAccessHint();
    if (currentUser && previousUser !== currentUser && !pending && !locationRequested) askLocationOnEntry();
    if (currentUser && previousUser !== currentUser && (pending || locationRequested)) {
      // Aguarda o fechamento do formulário de autenticação antes de continuar.
      const scheduledGeneration = generation;
      setTimeout(() => { if (scheduledGeneration === generation) resumePending(); }, 0);
    }
  }

  auth = await initAuth({ onSessionChange });
  shopping.refresh();

  try {
    config = await getConfig();
    shopping.setRestaurantOrdersEnabled(config.restaurant_orders_enabled);
    addresses.setDemoLocations(config.demo_locations);
    if (config.agent_mode === "demo") {
      const b = $("mode-badge");
      b.hidden = false;
      b.textContent = "Modo demonstração · dados fictícios · sem IA";
    }
  } catch { /* o erro aparece no primeiro envio */ }

  // ---- localização ----
  onLocationChange((loc) => {
    $("loc-label").textContent = loc ? loc.label || "Localização definida" : "Definir localização";
    $("loc-chip").classList.toggle("set", !!loc);
    updateAccessHint();
    shopping.render();
  });

  function openLocationDialog(message) { addresses.open(message); }

  async function applyLocation(loc, ownerId) {
    if (!ownerId || ownerId !== authSession?.user?.id) return;
    setLocation(loc);
    locationRequested = false;
    locationCard?.remove(); locationCard = null;
    addresses.close();
    await resumePending();
  }

  function requestLocation() {
    locationRequested = true;
    if (!authSession?.user) { auth.open(); return; }
    openLocationDialog();
  }

  async function authFailure() {
    if (dialog.open) dialog.close();
    locationRequested = true;
    try { await auth.refreshSession(); } catch { /* o login permitirá tentar novamente */ }
    await auth.open();
  }

  $("loc-chip").addEventListener("click", requestLocation);

  // ---- chat ----
  function promptForLocation() {
    if (locationCard?.isConnected) return;
    locationCard = chat.addLocationPrompt([
      { label: "📡 Usar minha localização", primary: true, onClick: async () => {
        const ownerId = authSession?.user?.id;
        if (!ownerId) return requestLocation();
        try { await applyLocation(await requestBrowserLocation(), ownerId); }
        catch (e) { openLocationDialog(LOCATION_ERRORS[e.code] || LOCATION_ERRORS.unavailable); }
      } },
      { label: "Informar endereço", onClick: requestLocation },
    ]);
  }

  async function resumePending() {
    if (busy || !authSession?.user) return;
    if (!getLocation()) {
      if (pending || locationRequested) { promptForLocation(); openLocationDialog(); }
      return;
    }
    if (pending) {
      const job = pending;
      pending = null;
      if (!job.ownerId || job.ownerId === authSession.user.id) await submit(job.message, job);
    }
  }

  const demoTag = (resp) => (resp.agent_mode === "demo" ? "Resposta do modo de teste (não é IA)" : null);

  // Os melhores resultados aparecem como cartões na conversa; o painel com todas as opções só abre em "Ver outras opções".
  function showResults() { /* sem abrir o painel sozinho */ }

  // Streaming (SSE); se o servidor não suportar, cai para o /api/chat comum.
  async function runTurn(payload, turnGeneration) {
    let stream = null;
    let panelOpened = false;
    let panelData = null;
    let final = null;
    try {
      await streamChat(payload, (name, data) => {
        if (turnGeneration !== generation) throw new DOMException("Conversa encerrada.", "AbortError");
        if (name === "status") chat.setTypingLabel(data.label);
        else if (name === "restaurants") { showResults(data); panelOpened = true; panelData = data; }
        else if (name === "delta") {
          if (!stream) { chat.hideTyping(); stream = chat.startAgentStream(); }
          stream.append(data.text);
        } else if (name === "done") final = data;
      });
    } catch (e) {
      if (!e.fallback || final || stream || panelOpened) throw e;
      final = await sendChat(payload);
    }
    if (turnGeneration !== generation) throw new DOMException("Conversa encerrada.", "AbortError");
    if (!final) throw new Error("A resposta terminou sem conteúdo. Tente novamente.");
    chat.hideTyping();
    if (stream) stream.finish(final.message, demoTag(final));
    else chat.addAgent(final.message, demoTag(final));
    if (final.open_panel && final.restaurants.length && !panelOpened) { showResults(final); panelData = final; }
    if (panelData?.restaurants?.length) {
      const query = lastQuery;
      chat.addRestaurants(panelData.restaurants, {
        onChoose: (restaurant) => shopping.openMenu(restaurant),
        onMore: () => panel.open(panelData, { query }),
      });
    }
    history.addMessage(payload.sessionId, "agent", final.message, demoTag(final));
    if (panelData) history.setPanel(payload.sessionId, panelData);
    await applyAgentEffects(final);
    return final;
  }

  // O que a IA fez na conta (sacola, pedido, endereços, favoritos) aparece na interface na hora.
  async function applyAgentEffects(final) {
    const parts = final.refresh || [];
    if (final.order_id) history.attachOrder(sessionId, final.order_id);
    try {
      if (parts.includes("cart") || parts.includes("order")) await shopping.refresh();
      if (parts.includes("addresses")) await addresses.load();
      if (parts.includes("favorites")) await orders.loadFavorites();
    } catch { /* a próxima atualização da interface tenta de novo */ }
    if (final.menu_restaurant) {
      chat.addRestaurants([final.menu_restaurant], { onChoose: (restaurant) => shopping.openMenu(restaurant) });
    }
    if (final.order_id) orders.openTracking(final.order_id);
  }

  async function submit(text, { echo = true, confirm = false } = {}) {
    if (busy || !text.trim()) return;
    const job = { message: text, echo, confirm, ownerId: authSession?.user?.id || null };
    if (authSession?.user && /(?:onde|status|acompanhar|chegou|demora|saiu).*(?:pedido|entrega)|(?:pedido|entrega).*(?:onde|status|chegou|demora|saiu)/i.test(text)) {
      input.value = "";
      if (echo) { chat.addUser(text); history.addMessage(sessionId, "user", text); }
      await delivery.query(); delivery.render();
      return;
    }
    if (!authSession?.user || !getLocation()) {
      pending = job;
      if (echo) input.value = text;
      updateAccessHint();
      if (!authSession?.user) { await auth.open(); return; }
      locationRequested = true;
      promptForLocation(); openLocationDialog();
      return;
    }
    pending = null;
    if (input.value === text) { input.value = ""; input.style.height = "auto"; }
    const turnGeneration = generation;
    const controller = new AbortController();
    activeController = controller;
    busy = true; sendBtn.disabled = true;
    if (echo) { chat.addUser(text); history.addMessage(sessionId, "user", text); lastQuery = text; }
    chat.showTyping();
    try {
      const resp = await runTurn({ message: text, sessionId, location: getLocation(), confirm,
        csrfToken: authSession.csrf_token, signal: controller.signal }, turnGeneration);
      if (resp.event_type === "location_required") { pending = { ...job, echo: false }; promptForLocation(); openLocationDialog(); }
      if (resp.event_type === "confirmation_required" && resp.pending_action) {
        chat.addLocationPrompt(
          [
            { label: "Confirmar", primary: true, onClick: () => { submit("Confirmo.", { confirm: true }); } },
            { label: "Cancelar", onClick: () => { chat.addAgent("Tudo bem, não vou executar essa ação."); } },
          ],
          resp.pending_action.summary ? `${resp.pending_action.label}: ${resp.pending_action.summary}` : `Confirmar ação: ${resp.pending_action.label}?`, false,
        );
      }
    } catch (e) {
      if (e.name === "AbortError" || turnGeneration !== generation) return;
      chat.hideTyping();
      if (e.status === 401) {
        pending = confirm ? null : { ...job, echo: true };
        if (!confirm) input.value = text;
        try { await auth.refreshSession(); } catch { /* a próxima abertura permite tentar novamente */ }
        await auth.open();
      } else if (e.status === 428) {
        pending = { ...job, echo: false };
        setLocation(null);
        promptForLocation(); openLocationDialog();
      } else chat.addError(e.message);
    } finally {
      if (activeController === controller) {
        activeController = null;
        busy = false; sendBtn.disabled = false;
        if (!dialog.open && !$("auth-dialog").open) input.focus();
      }
    }
  }

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = home.decorate(input.value);
    input.value = text;
    submit(text);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").requestSubmit(); }
  });
  input.addEventListener("input", () => {
    if (pending && pending.message !== input.value) pending = null;
    input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`;
  });

  // Exemplos "Experimente pedir assim": preenchem o campo e já enviam a busca.
  document.querySelectorAll("[data-send]").forEach((el) => el.addEventListener("click", () => {
    if (busy) return;
    input.value = el.dataset.send;
    $("composer").requestSubmit();
  }));

  if (new URLSearchParams(window.location.search).get("carrinho") === "1") await shopping.open();

  return { submit, panel, chat, auth, shopping, wallet, gifts, history, sidebar, home, addresses, orders, delivery };
}

if (!globalThis.__FOODAGENT_NO_AUTOINIT) initApp();
