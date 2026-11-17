// Barra lateral com busca nas conversas, menu completo e atalhos no modo compacto.
const $ = (id) => document.getElementById(id);
const MOBILE_QUERY = "(max-width: 820px)";
const SIDEBAR_KEY = "foodagent.sidebar";
const LEGACY_SIDEBAR_KEY = "foodagent.sidebar.expanded";

const DAY = 86400000;
function groupLabel(timestamp, now = Date.now()) {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (timestamp >= startOfToday) return "Hoje";
  if (timestamp >= startOfToday - DAY) return "Ontem";
  if (timestamp >= startOfToday - 7 * DAY) return "Últimos 7 dias";
  return "Mais antigos";
}

export function createSidebar({ app, history, getActive, onNewChat, onSelect, onDelete }) {
  const media = globalThis.matchMedia?.(MOBILE_QUERY);
  const isMobile = () => !!media?.matches;
  const list = $("history-list");
  const empty = $("history-empty");
  const emptyText = empty.textContent;
  const searchRow = $("history-search-row");
  const searchInput = $("history-search");
  const searchBtn = $("history-search-btn");
  const menu = $("account-menu");
  const trigger = $("account-trigger");
  const toggles = [...document.querySelectorAll("[data-sidebar-toggle]")];
  const sidebar = $("sidebar");
  const collapseBtn = $("sidebar-collapse");
  const store = () => { try { return window.localStorage; } catch { return null; } };
  let collapsed = false, mobileOpen = false, currentUser;
  try {
    const saved = store()?.getItem(SIDEBAR_KEY);
    collapsed = saved ? saved === "collapsed" : store()?.getItem(LEGACY_SIDEBAR_KEY) === "false";
  } catch { /* mantém a preferência em memória */ }
  sidebar.querySelectorAll(".side-item").forEach((button) => {
    const label = button.querySelector(".si-text")?.textContent.trim();
    if (label) { button.setAttribute("aria-label", label); button.title = label; }
  });

  // ---- abrir / fechar ----
  const isOpen = () => app.classList.contains("side-open");
  const isCollapsed = () => collapsed;
  function sync() {
    const expanded = isMobile() ? mobileOpen : !collapsed;
    app.classList.toggle("side-open", !isMobile() || mobileOpen);
    app.classList.toggle("side-collapsed", collapsed);
    toggles.forEach((t) => t.setAttribute("aria-expanded", String(expanded)));
    collapseBtn.setAttribute("aria-expanded", String(expanded));
    collapseBtn.setAttribute("aria-label", expanded ? "Recolher barra lateral" : "Expandir barra lateral");
    collapseBtn.title = collapseBtn.getAttribute("aria-label");
    $("sidebar-toggle").setAttribute("aria-label", expanded ? "Recolher barra lateral" : "Expandir barra lateral");
  }
  function setCollapsed(value, { focus = true } = {}) {
    if (isMobile()) { setOpen(!value, { focus }); return; }
    collapsed = value;
    try {
      store()?.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open");
      store()?.setItem(LEGACY_SIDEBAR_KEY, String(!collapsed));
    } catch { /* mantém a preferência em memória */ }
    if (collapsed) setSearch(false);
    sync();
    if (focus) (collapsed ? $("rail-expand") : collapseBtn).focus({ preventScroll: true });
  }
  function setOpen(open, { focus = true } = {}) {
    if (!isMobile()) { setCollapsed(!open, { focus }); return; }
    const focusWasInside = sidebar.contains(document.activeElement);
    mobileOpen = open;
    sync();
    if (focus && open) collapseBtn.focus({ preventScroll: true });
    else if (focus && focusWasInside) $("sidebar-toggle").focus({ preventScroll: true });
  }
  toggles.forEach((t) => t.addEventListener("click", () => setOpen(isMobile() ? !mobileOpen : collapsed)));
  $("sidebar-backdrop").addEventListener("click", () => { if (isMobile()) setOpen(false); });
  collapseBtn.addEventListener("click", () => isMobile() ? setOpen(false) : setCollapsed(true));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.hidden && (isMobile() ? mobileOpen : !collapsed)) setOpen(false); });
  sync();
  media?.addEventListener?.("change", () => { mobileOpen = false; sync(); });
  const close = () => { if (isOpen() && isMobile()) setOpen(false); };

  // ---- novo chat ----
  $("new-chat").addEventListener("click", () => { onNewChat(); close(); });
  document.querySelectorAll("[data-open-orders]").forEach((button) => button.addEventListener("click", close));

  // ---- recolher a gaveta numa faixa de ícones (computador) ----
  $("rail-expand").addEventListener("click", () => setCollapsed(false));
  $("rail-new").addEventListener("click", () => $("new-chat").click());
  $("rail-search").addEventListener("click", () => { setCollapsed(false, { focus: false }); setSearch(true); });
  $("rail-chats").addEventListener("click", () => { setCollapsed(false, { focus: false }); ($("history-list").querySelector(".hist-open") || collapseBtn).focus(); });
  $("rail-orders").addEventListener("click", () => document.querySelector('[data-open-orders="all"]').click());
  $("rail-month").addEventListener("click", () => document.querySelector('[data-open-orders="month"]').click());
  $("rail-avatar").addEventListener("click", () => $("profile-open").click());

  // ---- busca no histórico (lupa) ----
  function setSearch(open) {
    searchRow.hidden = !open;
    searchBtn.setAttribute("aria-expanded", String(open));
    $("rail-search").setAttribute("aria-expanded", String(open));
    if (open) searchInput.focus({ preventScroll: true });
    else if (searchInput.value) { searchInput.value = ""; render(); }
  }
  searchBtn.addEventListener("click", () => setSearch(searchRow.hidden));
  searchInput.addEventListener("input", () => render());
  searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    setSearch(false); searchBtn.focus();
  });

  // ---- histórico ----
  function render() {
    const query = searchInput.value.trim();
    const items = history.list(query);
    const active = getActive();
    empty.hidden = items.length > 0;
    empty.textContent = query ? `Nenhuma conversa encontrada para “${query}”.` : emptyText;
    const nodes = [];
    let currentGroup = null;
    for (const item of items) {
      const label = groupLabel(item.updatedAt);
      if (label !== currentGroup) {
        currentGroup = label;
        const h = document.createElement("li");
        h.className = "hist-group"; h.setAttribute("role", "presentation"); h.textContent = label;
        nodes.push(h);
      }
      const li = document.createElement("li");
      li.className = "hist-item" + (item.id === active ? " active" : "");
      const open = document.createElement("button");
      open.type = "button"; open.className = "hist-open"; open.textContent = item.title; open.title = item.title;
      if (item.id === active) open.setAttribute("aria-current", "true");
      open.addEventListener("click", () => { onSelect(item.id); close(); });
      const del = document.createElement("button");
      del.type = "button"; del.className = "hist-del"; del.textContent = "✕";
      del.setAttribute("aria-label", `Excluir conversa: ${item.title}`); del.title = "Excluir conversa";
      del.addEventListener("click", () => {
        if (globalThis.confirm && !globalThis.confirm("Excluir esta conversa?")) return;
        onDelete(item.id);
      });
      li.append(open, del);
      nodes.push(li);
    }
    list.replaceChildren(...nodes);
  }

  // ---- menu do usuário ----
  function setMenu(open) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  }
  trigger.addEventListener("click", (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener("click", () => { setMenu(false); close(); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !$("account").contains(e.target)) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); trigger.focus(); } });

  function initials(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "👤";
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  function setUser(user) {
    const nextUser = user?.id || user?.email || null;
    if (nextUser !== currentUser) { currentUser = nextUser; setSearch(false); }
    $("account-avatar").textContent = initials(user?.name);
    $("rail-avatar").textContent = initials(user?.name);
    $("rail-avatar").hidden = !user;
    $("account-sub").textContent = user ? user.email || "Conta FoodAgent" : "Não conectado";
    $("account-guest").hidden = !!user; // o nome do usuário em si é preenchido por auth.js (#account-name)
    $("account").hidden = !user; // visitante vê o botão "Entrar"; conectado vê o avatar
    setMenu(false);
  }

  return { render, setUser, isMobile, setOpen, setCollapsed, isCollapsed };
}
