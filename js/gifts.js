import { getJson, updateShopping } from "./api.js";
import { $, message, openDialog, node, assetUrl, thumb } from "./ui.js";

const COST = 1000;
const VARIANT_IMAGES = { "lacta-oreo": "img/gift-lacta-oreo.jpg", "serenata-de-amor": "img/gift-serenata-de-amor.jpg" };
const number = cents => (cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export function createGifts({ getSession, refreshSession, openLogin, wallet, openBag = () => {}, openTracking = () => {} }) {
  const dialog = $("gift-dialog");
  let owner = null, generation = 0, busy = false, state = null;
  const textFields = { title: "gift-hero-title", subtitle: "gift-hero-subtitle", bubble: "gift-hero-bubble",
    dialog_title: "gift-title", intro_title: "gift-intro-title", intro: "gift-intro-text" };
  const defaults = Object.fromEntries(Object.entries(textFields).map(([key, id]) => [key, $(id).textContent]));
  const heroImage = $("gift-hero-image");
  const defaultImage = { src: heroImage.getAttribute("src"), alt: heroImage.alt };
  const fieldset = dialog.querySelector(".gift-variants");
  const defaultLegend = fieldset.querySelector("legend").textContent;
  const defaultVariants = [...fieldset.querySelectorAll("input")].map(input => ({ id: input.value,
    name: input.closest("label").querySelector(".gift-variant-name").textContent.trim() }));
  let variantSignature = null;

  function renderOffer() {
    const offer = state?.offer;
    const presentation = offer?.presentation || defaults;
    for (const [key, id] of Object.entries(textFields)) $(id).textContent = presentation[key] || defaults[key];
    const src = offer?.image_url ? assetUrl(offer.image_url) : defaultImage.src;
    if (heroImage.getAttribute("src") !== src) heroImage.setAttribute("src", src);
    heroImage.alt = offer?.image_url ? offer.name : defaultImage.alt;
    const variants = offer?.variants || defaultVariants;
    const signature = JSON.stringify({ variants, image: offer?.image_url, cost: offer?.cost_cents || COST });
    if (signature !== variantSignature) {
      const selected = fieldset.querySelector("input:checked")?.value;
      const chosen = variants.some(variant => variant.id === selected) ? selected : variants[0]?.id;
      const labels = variants.map(variant => {
        const label = node("label", "gift-variant"), input = node("input");
        input.type = "radio"; input.name = "gift-variant"; input.value = variant.id;
        input.required = true; input.checked = variant.id === chosen;
        const photo = thumb(VARIANT_IMAGES[variant.id] || offer?.image_url || defaultImage.src);
        const image = photo.querySelector("img");
        image.width = 160; image.height = 160; image.decoding = "async";
        const end = node("span", "gift-variant-end");
        end.append(node("span", "gift-variant-price", number(offer?.cost_cents || COST) + " moedas"), input);
        label.append(photo, node("span", "gift-variant-name", variant.name), end);
        return label;
      });
      fieldset.replaceChildren(node("legend", null, presentation.selection_title || defaultLegend), ...labels);
      variantSignature = signature;
    }
  }

  function apply(data) {
    if (data?.offer?.cost_cents !== COST || !Number.isSafeInteger(data.wallet?.balance_cents)) {
      throw new Error("Não foi possível carregar o brinde. Tente novamente.");
    }
    state = data;
  }

  function render() {
    renderOffer();
    const redemption = state?.redemption;
    $("gift-fields").hidden = !owner || !state || !!redemption;
    $("gift-confirmed").hidden = !redemption;
    $("gift-hero-action").textContent = redemption ? "Acompanhar" : state?.cart_item ? "Ver sacola" : "Resgatar";
    $("gift-open").setAttribute("aria-label", redemption ? "Acompanhar pedido do brinde de boas-vindas"
      : state?.offer?.presentation ? `Resgatar ${state.offer.name} por 10 moedas` : "Resgatar 1 bombom por pessoa por 10 moedas. Opções: Lacta Oreo ou Serenata de Amor");
    if (redemption) {
      $("gift-confirmed-title").textContent = { pending: "Brinde em preparação!", delivering: "Seu brinde está a caminho!", delivered: "Brinde entregue. Aproveite!" }[redemption.status];
      $("gift-confirmed-address").textContent = redemption.address.line;
      $("gift-confirmed-note").textContent = "Pedido #" + redemption.id.slice(0, 8) + " · 1 brinde por pessoa · Entrega pela equipe FoodAgent.";
    }
    $("gift-submit").textContent = busy ? "Aguarde…" : !owner ? "Entrar para resgatar" : redemption ? "Acompanhar pedido"
      : !state ? "Tentar novamente" : "Adicionar à sacola · 10 moedas";
    $("gift-submit").formNoValidate = !owner || !state || !!redemption;
    dialog.querySelectorAll("input, button").forEach(control => { control.disabled = busy && control.id !== "gift-close"; });
    dialog.setAttribute("aria-busy", String(busy));
  }

  async function refresh() {
    if (!owner || busy) return;
    const current = generation;
    busy = true; render();
    try {
      const data = await getJson("gifts/welcome-popsicle");
      if (current === generation) apply(data);
    } catch (error) {
      if (current === generation) message("gift-error", error.message);
    } finally { if (current === generation) { busy = false; render(); } }
  }

  async function open() {
    const current = generation;
    message("gift-error");
    if (owner) await refresh();
    if (current !== generation) return;
    if (state?.redemption?.order_id) { if (dialog.open) dialog.close(); await openTracking(state.redemption.order_id); return; }
    if (state?.cart_item) { if (dialog.open) dialog.close(); await openBag(); return; }
    render(); openDialog(dialog);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!owner) { dialog.close(); openLogin(); return; }
    if (!state) { await refresh(); return; }
    if (state.redemption) { dialog.close(); await openTracking(state.redemption.order_id); return; }
    if (!$("gift-form").reportValidity()) return;
    const variant = dialog.querySelector('input[name="gift-variant"]:checked')?.value;
    const current = generation;
    busy = true; message("gift-error"); render();
    try {
      await refreshSession();
      if (current !== generation) return;
      const data = await updateShopping("gifts/welcome-popsicle/cart", { variant }, getSession().csrf_token);
      if (current !== generation) return;
      apply(data); wallet.accept(data.wallet);
      dialog.close(); await openBag(data.shopping);
    } catch (error) {
      if (current === generation) {
        message("gift-error", error.message);
        if (!dialog.open) openDialog(dialog);
        if (error.status === 409) { busy = false; await refresh(); }
      }
    } finally { if (current === generation) { busy = false; render(); } }
  }

  $("gift-open").addEventListener("click", open);
  $("gift-close").addEventListener("click", () => dialog.close());
  $("gift-form").addEventListener("submit", submit);
  render();
  return { open, refresh, setSession(session) {
    const next = session?.user?.id || null;
    if (next === owner) return;
    owner = next; generation++; state = null; busy = false;
    if (dialog.open) dialog.close();
    message("gift-error"); render();
    fieldset.querySelector("input").checked = true;
    if (owner) void refresh();
  } };
}
