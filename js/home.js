// Tela inicial: compositor dentro do herói e preferências do pedido.
const $ = (id) => document.getElementById(id);
const MOBILE_QUERY = "(max-width: 820px)";

// Preferências que viram texto do pedido. "Perto de mim" já é o comportamento padrão da busca,
// por isso só acrescenta algo quando é desligado.
const MODE_TEXT = {
  perto: { on: "", off: "qualquer distância" },
  rapido: { on: "entrega rápida", off: "" },
  avaliado: { on: "bem avaliado", off: "" },
};

export function createHome({ app, welcome, input }) {
  const dock = $("composer-dock");
  const slot = $("composer-slot");
  const chatCol = document.querySelector(".chat-col");

  // ---- compositor: dentro do herói no início; embaixo da conversa depois da 1ª mensagem ----
  const homePlaceholder = input.placeholder;
  const mql = globalThis.matchMedia?.(MOBILE_QUERY);
  // No celular o campo é estreito: usa o exemplo curto do design.
  const currentPlaceholder = () => (mql?.matches ? "Ex: pizza para 2, sem cebola" : homePlaceholder);
  function placeComposer() {
    const home = !welcome.hidden;
    app.classList.toggle("is-home", home);
    input.placeholder = home ? currentPlaceholder() : "Escreva sua mensagem…";
    const target = home ? slot : chatCol;
    if (dock.parentElement !== target) target.append(dock);
  }
  const Observer = welcome.ownerDocument.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (Observer) new Observer(placeComposer).observe(welcome, { attributes: true, attributeFilter: ["hidden"] });
  placeComposer();

  // O campo muda de exemplo quando a tela passa de/para celular.
  const placeAccount = () => { if (!welcome.hidden) input.placeholder = currentPlaceholder(); };
  mql?.addEventListener?.("change", placeAccount);

  // ---- preferências do pedido ----
  const modes = { perto: true, rapido: false, avaliado: false };
  document.querySelectorAll("[data-mode]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.mode;
      modes[key] = !modes[key];
      chip.setAttribute("aria-pressed", String(modes[key]));
    });
  });

  function decorate(text) {
    const base = (text || "").trim();
    if (!base || !app.classList.contains("is-home")) return text;
    const lower = base.toLowerCase();
    const extras = Object.entries(MODE_TEXT)
      .map(([key, words]) => (modes[key] ? words.on : words.off))
      .filter((phrase) => phrase && !lower.includes(phrase));
    return extras.length ? `${base.replace(/[\s.,;!?]+$/, "")}, ${extras.join(", ")}` : base;
  }

  // ---- exemplos e cards: preenchem o campo, quem decide enviar é a pessoa ----
  function fill(text) {
    input.value = text;
    input.dispatchEvent(new (input.ownerDocument.defaultView.Event)("input", { bubbles: true }));
    input.focus();
  }
  document.querySelectorAll("[data-fill]").forEach((el) => el.addEventListener("click", () => fill(el.dataset.fill)));
  // Cartões que não são <button> também respondem ao teclado.
  document.querySelectorAll('[data-fill][role="button"]').forEach((el) => el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); el.click(); }
  }));

  return { decorate, placeComposer, placeAccount };
}
