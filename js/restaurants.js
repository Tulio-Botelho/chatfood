// Tela de resultados. Todo texto é inserido via textContent (sem innerHTML).
import { assetUrl, imageFor, fmtKm } from "./ui.js";

const RANKING_NOTES = {
  rating_distance: "Ordenado por avaliação (ajustada pela quantidade de avaliações) e distância.",
  distance_only: "Ordenado por proximidade (sem avaliações disponíveis nesta fonte).",
  mixed: "Avaliados primeiro (nota + distância); os sem avaliação vêm depois, por distância.",
};
const SORTS = {
  best: { label: "Melhor escolha", sort: null },
  near: { label: "Mais perto", sort: (a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) },
  rating: { label: "Melhor nota", sort: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) },
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function photo(restaurant, tag) {
  const wrap = el("span", "res-photo");
  const img = el("img");
  img.src = assetUrl(restaurant.image_url || imageFor(restaurant.name, restaurant.category));
  img.alt = ""; img.loading = "lazy";
  wrap.append(img);
  if (tag) wrap.append(el("span", "res-tag", tag));
  return wrap;
}

function details(r) {
  const line = el("span", "res-line");
  if (r.rating != null && r.review_count) line.append(el("span", "rating", `★ ${r.rating.toFixed(1).replace(".", ",")}`));
  const kind = [r.cuisine_label, fmtKm(r.distance_km)].filter(Boolean).join(" · ");
  if (kind) line.append(el("span", null, kind));
  if (!line.childNodes.length) line.textContent = "Sem avaliações disponíveis";
  return line;
}

/** Cartão de restaurante. `featured` usa a versão grande ("Escolha do agente"). */
export function renderCard(r, onSelect, featured = false) {
  const card = el("button", featured ? "res-hero" : "res-card");
  card.type = "button";
  const info = el("span", "res-info");
  const title = el("h3", null, r.name);
  if (r.is_simulated) title.append(el("span", "badge", "Dados fictícios"));
  info.append(title, details(r), el("small", null, r.address || "Endereço não disponível"));
  card.append(photo(r, featured ? "Escolha do agente" : null), info);
  card.setAttribute("aria-label", `Ver cardápio de ${r.name}`);
  if (onSelect) card.addEventListener("click", () => onSelect(r));
  else card.disabled = true;
  return card;
}

export function createPanel({ app, panel, title, sub, notes, list, foot, closeBtn, summary, chips, onSelect, onEdit }) {
  let current = null;
  let sortKey = "best";
  let query = "";
  const close = () => {
    app.classList.remove("panel-open");
    panel.setAttribute("aria-hidden", "true");
  };
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function renderList() {
    if (!current) return;
    const sorter = SORTS[sortKey].sort;
    const restaurants = sorter ? [...current.restaurants].sort(sorter) : current.restaurants;
    list.replaceChildren(...restaurants.map((r, index) => renderCard(r, onSelect, index === 0 && sortKey === "best")));
    list.scrollTop = 0;
    chips?.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === sortKey)));
  }

  if (chips) {
    chips.replaceChildren(...Object.entries(SORTS).map(([key, { label }]) => {
      const b = el("button", "pick-chip", label);
      b.type = "button"; b.dataset.sort = key;
      b.addEventListener("click", () => { sortKey = key; renderList(); });
      return b;
    }));
  }

  function open(resp, context = {}) {
    current = resp; sortKey = "best";
    const s = resp.search;
    query = context.query ?? query;
    title.textContent = "Resultados";
    sub.textContent = `${resp.restaurants.length} ${resp.restaurants.length === 1 ? "restaurante encontrado" : "restaurantes encontrados"}${s?.title ? ` · ${s.title}` : ""}`;
    if (summary) {
      summary.hidden = !query;
      summary.replaceChildren();
      if (query) {
        const text = el("span");
        text.append("Seu pedido", el("strong", null, query));
        const edit = el("button", "link-btn", "Editar");
        edit.type = "button";
        edit.addEventListener("click", () => { close(); onEdit?.(query); });
        summary.append(text, edit);
      }
    }
    notes.replaceChildren();
    const ranking = RANKING_NOTES[s?.ranking_mode];
    [ranking, ...(resp.warnings || [])].filter(Boolean).forEach((t) => notes.append(el("div", "note", t)));
    renderList();
    foot.textContent = s?.attribution || "";
    app.classList.add("panel-open");
    panel.setAttribute("aria-hidden", "false");
  }
  return { open, close, clear() {
    close(); current = null; query = "";
    title.textContent = "Resultados";
    sub.textContent = "";
    summary?.replaceChildren(); if (summary) summary.hidden = true;
    notes.replaceChildren(); list.replaceChildren(); foot.textContent = "";
  } };
}
