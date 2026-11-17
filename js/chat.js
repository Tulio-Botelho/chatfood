// Renderização do histórico de conversa.
import { assetUrl, imageFor, fmtKm } from "./ui.js";
export function createChat({ messages, welcome }) {
  const scroll = () => { messages.scrollTop = messages.scrollHeight; };
  const hideWelcome = () => welcome && (welcome.hidden = true);

  function add(role, text, extra) {
    hideWelcome();
    const row = document.createElement("div");
    row.className = `msg ${role}`;
    if (role !== "user") {
      const av = document.createElement("div");
      av.className = "avatar"; av.textContent = "🍽️"; av.setAttribute("aria-hidden", "true");
      row.append(av);
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    if (extra) bubble.append(extra);
    row.append(bubble);
    messages.append(row);
    scroll();
    return row;
  }

  let typingRow = null;
  return {
    /** Esvazia a conversa e volta à tela de boas-vindas. */
    clear() {
      typingRow = null;
      [...messages.children].forEach((el) => { if (el !== welcome) el.remove(); });
      if (welcome) welcome.hidden = false;
      messages.scrollTop = 0;
    },
    addUser: (t) => add("user", t),
    addAgent: (t, tag) => {
      let extra = null;
      if (tag) { extra = document.createElement("div"); extra.className = "meta-tag"; extra.textContent = tag; }
      return add("agent", t, extra);
    },
    addError: (t) => add("agent error", t),
    /** Carrossel com os melhores resultados dentro da conversa. */
    addRestaurants(restaurants, { onChoose, onMore }) {
      hideWelcome();
      const rail = document.createElement("div");
      rail.className = "chat-cards";
      for (const r of restaurants.slice(0, 3)) {
        const card = document.createElement("article");
        card.className = "chat-card";
        const photo = document.createElement("span");
        photo.className = "res-photo";
        const img = document.createElement("img");
        img.src = assetUrl(r.image_url || imageFor(r.name, r.category)); img.alt = ""; img.loading = "lazy";
        photo.append(img);
        const info = document.createElement("div");
        info.className = "res-info";
        const name = document.createElement("h3"); name.textContent = r.name;
        const line = document.createElement("small");
        line.textContent = [r.rating != null && r.review_count ? `★ ${r.rating.toFixed(1).replace(".", ",")}` : "", fmtKm(r.distance_km)].filter(Boolean).join(" · ");
        info.append(name, line);
        const choose = document.createElement("button");
        choose.type = "button"; choose.textContent = "Escolher";
        choose.setAttribute("aria-label", `Escolher ${r.name}`);
        choose.addEventListener("click", () => onChoose(r));
        card.append(photo, info, choose);
        rail.append(card);
      }
      messages.append(rail);
      if (onMore) {
        const more = document.createElement("button");
        more.type = "button"; more.className = "btn chat-more"; more.textContent = "Ver outras opções";
        more.addEventListener("click", onMore);
        // Mesma coluna e recuo das respostas do agente.
        const row = document.createElement("div");
        row.className = "chat-more-row";
        row.append(more);
        messages.append(row);
      }
      scroll();
      return rail;
    },
    showTyping() {
      if (typingRow) return;
      const wrap = document.createElement("span");
      wrap.className = "typing";
      wrap.setAttribute("aria-label", "FoodAgent está pensando");
      wrap.innerHTML = "<i></i><i></i><i></i>";
      const label = document.createElement("small");
      label.className = "typing-label";
      wrap.append(label);
      typingRow = add("agent", "", wrap);
    },
    setTypingLabel(text) {
      const l = typingRow?.querySelector(".typing-label");
      if (l) l.textContent = text;
    },
    hideTyping() { typingRow?.remove(); typingRow = null; },
    /** Mensagem do agente que cresce conforme chegam os deltas do streaming. */
    startAgentStream() {
      const row = add("agent", "");
      const bubble = row.querySelector(".bubble");
      return {
        append(t) { bubble.textContent += t; scroll(); },
        finish(text, tag) {
          bubble.textContent = text;
          if (tag) {
            const m = document.createElement("div");
            m.className = "meta-tag"; m.textContent = tag;
            bubble.append(m);
          }
          scroll();
        },
      };
    },
    addLocationPrompt(buttons, title = "Como você quer informar sua localização?", keepCard = true) {
      const row = document.createElement("div");
      row.className = "chat-prompt-row";
      const card = document.createElement("div");
      card.className = "loc-card";
      row.append(card);
      const p = document.createElement("p");
      p.textContent = title;
      card.append(p);
      buttons.forEach(({ label, primary, onClick }) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = `btn${primary ? " primary" : ""}`; b.textContent = label;
        b.addEventListener("click", () => { if (onClick() !== false && keepCard === false) row.remove(); });
        card.append(b);
      });
      hideWelcome();
      messages.append(row);
      scroll();
      return row;
    },
  };
}
