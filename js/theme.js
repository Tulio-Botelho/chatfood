// Aparência: Claro (padrão), Escuro ou Automático (segue o sistema), lembrada neste navegador.
const KEY = "foodagent.theme";
const COLORS = { light: "#fff8f0", dark: "#181818" };

function stored() {
  // Sem escolha salva, o padrão é o modo claro.
  try { const value = globalThis.localStorage?.getItem(KEY); return value === "dark" || value === "auto" ? value : "light"; } catch { return "light"; }
}

export function initTheme() {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll("[data-theme-choice]")];

  function apply(choice) {
    if (choice === "auto") delete root.dataset.theme; else root.dataset.theme = choice;
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeChoice === choice)));
    // Cor da barra do navegador/PWA: segue a escolha; no automático volta a seguir o sistema.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.dataset.scheme ||= /dark/.test(meta.getAttribute("media") || "") ? "dark" : "light";
      const scheme = meta.dataset.scheme;
      meta.setAttribute("content", COLORS[scheme]);
      if (choice === "auto") meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
      else meta.setAttribute("media", choice === scheme ? "all" : "not all");
    });
  }

  buttons.forEach((b) => b.addEventListener("click", () => {
    const choice = b.dataset.themeChoice;
    try { globalThis.localStorage?.setItem(KEY, choice); } catch { /* sem storage */ }
    apply(choice);
  }));
  // Abas das configurações: só a seção escolhida aparece.
  const tabs = [...document.querySelectorAll("[data-settings-target]")];
  const showTab = (tab) => tabs.forEach((other) => {
    const on = other === tab;
    if (on) other.setAttribute("aria-current", "page"); else other.removeAttribute("aria-current");
    other.setAttribute("aria-selected", String(on));
    const panel = document.getElementById(other.dataset.settingsTarget);
    if (panel) panel.hidden = !on;
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      showTab(next); next.focus();
    });
  });
  apply(stored());
  return { apply, current: stored };
}
