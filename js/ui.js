// Utilitários de interface compartilhados pelas telas. Todo texto entra via textContent.
import { assetUrl } from "./assets.js";
export { assetUrl } from "./assets.js";
export const $ = (id) => document.getElementById(id);
export const money = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const clock = (seconds) => new Date(seconds * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export const dateLabel = (seconds) => new Date(seconds * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
export const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;

export function node(tag, cls, text) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text != null) element.textContent = text;
  return element;
}

export function message(id, text = "") {
  $(id).textContent = text;
  $(id).hidden = !text;
}

const IMAGES = { burger: "img/dish-burger.jpg", sushi: "img/dish-sushi.jpg", pizza: "img/dishes/pizza-hero.jpg", bowl: "img/dish-bowl.jpg" };
const BY_CATEGORY = { pizza: "pizza", hamburguer: "burger", sushi: "sushi", japonesa: "sushi", massas: "pizza", brasileira: "bowl" };

// Pizzas: uma foto por sabor (fotos ilustrativas de bancos de imagem livres; créditos em img/dishes/CREDITS.md).
const PIZZA_FLAVORS = [
  [/vegan|veggie|vegetar|legume/, "img/dishes/veganissima.jpg"],
  [/abobrinha|zucchini/, "img/dishes/abobrinha.jpg"],
  [/marg|caprese/, "img/dishes/marguerita.jpg"],
  [/lingui|calabresa|lombo|bacon|portuguesa/, "img/dishes/linguica.jpg"],
  [/frango|requeij|catupiry/, "img/dishes/frango-requeijao.jpg"],
  [/queijo|mussarela|mucarela|parmes/, "img/dishes/quatro-queijos.jpg"],
];
// Fotos por prato: vale a primeira regra que casar com o nome (sem acento e em minúsculas) dentro da categoria do
// restaurante. Sem categoria conhecida, nada aqui vale e segue a lógica antiga. Fotos ilustrativas do Pixabay;
// créditos em img/dishes/CREDITS.md.
const PIZZA = ["pizza"], BURGER = ["hamburguer"], JAPA = ["sushi", "japonesa"], PASTA = ["massas"], BR = ["brasileira"];
const DISH_PHOTOS = [
  [/atum/, "pizza-atum", PIZZA], [/abacaxi/, "pizza-abacaxi", PIZZA], [/alho ?por/, "pizza-alho-poro", PIZZA],
  [/carne seca/, "pizza-carne-seca", PIZZA], [/parma|brie/, "pizza-parma-brie", PIZZA], [/jalapeno/, "pizza-jalapeno", PIZZA],
  [/marinara/, "pizza-marinara", PIZZA], [/bbq|barbecue/, "pizza-bbq", PIZZA], [/maiale|porco|salame|pepperoni/, "pizza-maiale", PIZZA],
  [/smash/, "burger-smash", BURGER], [/vegetarian|veggie|vegano/, "burger-veggie", BURGER], [/\begg\b|\bovo\b/, "burger-ovo", BURGER],
  [/bacon/, "burger-bacon", BURGER], [/cheese/, "burger-cheese", BURGER], [/artesanal|gourmet/, "burger-artesanal", BURGER],
  [/missoshiru|miso/, "sushi-missoshiru", JAPA], [/gyoza/, "sushi-gyoza", JAPA], [/croquete/, "sushi-croquete", JAPA],
  [/ebidon|donburi/, "sushi-ebidon", JAPA], [/fry de camarao/, "sushi-fry-camarao", JAPA], [/fry de frango/, "sushi-fry-frango", JAPA],
  [/fry de peixe/, "sushi-fry-peixe", JAPA], [/shimeji/, "sushi-shimeji", JAPA], [/cubos|citric|sashimi/, "sushi-salmao-cubos", JAPA],
  [/temaki/, "sushi-temaki", JAPA], [/\bhots?\b|hotphila|hot ?roll/, "sushi-hot-roll", JAPA],
  [/combinado|combo|mix|\bpecas\b|\btop \d+/, "sushi-combinado", JAPA],
  [/bolonhesa/, "massa-bolonhesa", PASTA], [/camar/, "massa-camarao", PASTA], [/ragu/, "massa-ragu", PASTA],
  [/penne/, "massa-penne-bacon", PASTA], [/pomodor|arrabiata|sugo/, "massa-pomodoro", PASTA], [/aglio|oglio/, "massa-aglio-olio", PASTA],
  [/infornata|lasanha/, "massa-lasanha", ["massas", "brasileira"]], [/fettuccine/, "massa-fettuccine", PASTA],
  [/fusilli/, "massa-fusilli", PASTA], [/./, "massa-bolonhesa", PASTA],
  [/strogonoff|estrogonofe|stroganoff/, "br-strogonoff", BR], [/feijoada/, "br-feijoada", BR], [/parmegiana|parmigiana/, "br-parmegiana", BR],
  [/fricasse/, "br-fricasse", BR], [/galinhada/, "br-galinhada", BR], [/wings/, "br-wings", BR], [/almondega/, "br-almondegas", BR],
  [/tilapia|brandade/, "br-tilapia", BR], [/lombo|porco/, "br-lombo", BR], [/tropeir/, "br-tropeiro", BR], [/nhoque/, "br-nhoque", BR],
  [/brigadeiro/, "br-brigadeiro", BR], [/bife|carne de boi|farofa/, "br-bife", BR], [/grelhado|frango/, "br-frango-grelhado", BR],
];
const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Foto de apoio: sabor da pizza, categoria do restaurante ou palavras do nome do prato. */
function imagePath(text = "", category = null) {
  const t = plain(text);
  if (/lacta oreo/.test(t) && !/serenata de amor/.test(t)) return "img/gift-lacta-oreo.jpg";
  if (/serenata de amor/.test(t) && !/lacta oreo/.test(t)) return "img/gift-serenata-de-amor.jpg";
  if (category === "bombom" || /bombom|lacta oreo|serenata de amor|sonho de valsa|ouro branco/.test(t)) return "img/hero-bonbons.jpg";
  for (const [pattern, file, scopes] of DISH_PHOTOS) {
    if (category && scopes.includes(category) && pattern.test(t)) return `img/dishes/${file}.jpg`;
  }
  // Nomes de pizza (ex.: "Frango com requeijão 30cm") nem sempre trazem a palavra "pizza".
  if (category === "pizza" || /pizza|\b\d{2} ?cm\b|marguerita|veganissima|calabresa|quatro queijos/.test(t)) {
    const flavor = PIZZA_FLAVORS.find(([pattern]) => pattern.test(t));
    if (flavor) return flavor[1];
  }
  if (category && BY_CATEGORY[category]) return IMAGES[BY_CATEGORY[category]];
  if (/burg|hamb|smash|lanche|cheese/.test(t)) return IMAGES.burger;
  if (/sushi|temaki|nigiri|sashimi|japon|yaki|uramaki|hot ?roll|combo|salm/.test(t)) return IMAGES.sushi;
  if (/pizza|calabresa|marg|massa|lasanha|macarr|espaguete|talharim|nhoque|fettuc/.test(t)) return IMAGES.pizza;
  return IMAGES.bowl;
}

export function imageFor(text = "", category = null) { return assetUrl(imagePath(text, category)); }

export function thumb(src, extra) {
  const wrap = node("span", "dish-thumb");
  const img = node("img");
  img.src = assetUrl(src); img.alt = ""; img.loading = "lazy";
  wrap.append(img);
  if (extra) wrap.append(extra);
  return wrap;
}

export const fmtKm = (km) => (km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`);
export const pluralItems = (count) => (count === 1 ? "item" : "itens");

const dismissibleDialogs = new WeakSet();

export function openDialog(dialog) {
  if (!dismissibleDialogs.has(dialog)) {
    let pressedBackdrop = false;
    const isBackdrop = (event) => {
      if (event.target !== dialog) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
    };
    dialog.addEventListener("pointerdown", (event) => { pressedBackdrop = isBackdrop(event); });
    dialog.addEventListener("click", (event) => {
      const close = pressedBackdrop && isBackdrop(event);
      pressedBackdrop = false;
      if (close) dialog.close();
    });
    dialog.addEventListener("close", () => { pressedBackdrop = false; });
    dismissibleDialogs.add(dialog);
  }
  if (!dialog.open) dialog.showModal();
}
