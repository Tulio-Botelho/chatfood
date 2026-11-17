import { getWallet } from "./api.js";
import { openDialog } from "./ui.js";

const $ = (id) => document.getElementById(id);
const number = (value) => value.toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });

export function createWallet({ openLogin }) {
  const dialog = $("wallet-dialog");
  let owner = null, generation = 0, busy = false, balance = null, method = "pix";
  let pixComplete = false;
  let balanceVersion = 0, returnToOrder = null;
  const message = (id, text = "") => { $(id).textContent = text; $(id).hidden = !text; };
  const amount = () => Number($("wallet-amount").value);
  const validAmount = () => Number.isInteger(amount()) && amount() >= 1 && amount() <= 10000;

  function cardComplete() {
    const digits = $("wallet-card-number").value.replace(/\s/g, "");
    const expiry = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec($("wallet-card-expiry").value);
    const now = new Date();
    const validExpiry = expiry && (2000 + Number(expiry[2])) * 12 + Number(expiry[1]) >= now.getFullYear() * 12 + now.getMonth() + 1;
    return /^\d{13,19}$/.test(digits) && $("wallet-card-name").value.trim().length >= 2
      && validExpiry && /^\d{3,4}$/.test($("wallet-card-cvv").value);
  }

  function render() {
    $("wallet-count").textContent = owner ? (balance === null ? "—" : number(balance)) : "0";
    $("wallet-open").setAttribute("aria-label", owner
      ? `Moedas FoodAgent: ${balance === null ? "saldo indisponível" : number(balance)}. Abrir carteira`
      : "Moedas FoodAgent: entrar para consultar");
    $("wallet-balance").textContent = balance === null ? "—" : number(balance);
    message("wallet-conversion", validAmount() ? "" : "Informe um valor inteiro entre R$ 1 e R$ 10.000.");
    $("wallet-pix").hidden = method !== "pix";
    $("wallet-card").hidden = method !== "card";
    $("wallet-card").disabled = method !== "card" || busy;
    $("wallet-pix-tab").setAttribute("aria-pressed", String(method === "pix"));
    $("wallet-card-tab").setAttribute("aria-pressed", String(method === "card"));
    $("wallet-form").querySelectorAll("input, button").forEach((control) => {
      control.disabled = busy && !["wallet-copy", "wallet-pix-key"].includes(control.id);
    });
    $("wallet-pix-pay").disabled = !owner || !validAmount();
    $("wallet-pix-pay").textContent = pixComplete ? "Pix concluído" : "Pagamento Pix";
    $("wallet-card-pay").disabled = busy || !owner || !validAmount() || !cardComplete();
    dialog.setAttribute("aria-busy", String(busy));
  }

  function clearCard() {
    for (const suffix of ["number", "name", "expiry", "cvv"]) $(`wallet-card-${suffix}`).value = "";
  }

  function apply(data) {
    const cents = data?.balance_cents ?? (Number.isSafeInteger(data?.balance) ? data.balance * 100 : NaN);
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Não foi possível carregar o saldo.");
    balance = cents / 100;
  }

  function accept(data) {
    if (!owner) return;
    apply(data); balanceVersion++; render();
  }

  async function refresh() {
    if (!owner || busy) return;
    const current = generation;
    const version = balanceVersion;
    busy = true; message("wallet-error"); render();
    try {
      const data = await getWallet();
      if (current === generation && version === balanceVersion) apply(data);
    } catch (error) {
      if (current === generation && version === balanceVersion) { balance = null; message("wallet-error", error.message); }
    } finally { if (current === generation) { busy = false; render(); } }
  }

  function setSession(session) {
    const next = session?.user?.id || null;
    if (next === owner) return;
    owner = next; generation++; busy = false; balance = null; method = "pix"; pixComplete = false;
    returnToOrder = null; balanceVersion++;
    if (dialog.open) dialog.close();
    clearCard(); $("wallet-amount").value = "10";
    message("wallet-status"); message("wallet-error"); render();
    message("wallet-checkout-message");
    if (owner) void refresh();
  }

  async function open({ shortfallCents = 0, onClose = null } = {}) {
    if (!owner) return openLogin();
    returnToOrder = onClose;
    if (shortfallCents > 0) $("wallet-amount").value = String(Math.min(10000, Math.ceil(shortfallCents / 100)));
    message("wallet-checkout-message", shortfallCents > 0
      ? `Faltam ${number(shortfallCents / 100)} moedas para concluir seu pedido. A recarga por Pix ou cartão ainda não está disponível.` : "");
    $("wallet-close").setAttribute("aria-label", onClose ? "Voltar à sacola" : "Fechar carteira");
    pixComplete = false; render();
    message("wallet-status");
    openDialog(dialog);
    await refresh();
  }

  function pay(event) {
    event.preventDefault();
    if (!owner || !validAmount() || (method === "card" && (busy || !cardComplete()))) return;
    if (method === "pix") pixComplete = true;
    clearCard();
    message("wallet-error");
    message("wallet-status");
    render();
  }

  $("wallet-open").addEventListener("click", open);
  $("wallet-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    clearCard(); render();
    const callback = returnToOrder; returnToOrder = null;
    callback?.();
  });
  $("wallet-form").addEventListener("submit", pay);
  $("wallet-form").addEventListener("input", () => { pixComplete = false; render(); });
  for (const type of ["pix", "card"]) $(`wallet-${type}-tab`).addEventListener("click", () => {
    method = type; pixComplete = false; clearCard(); message("wallet-status"); message("wallet-error"); render();
  });
  document.querySelectorAll("[data-wallet-amount]").forEach((button) => button.addEventListener("click", () => {
    $("wallet-amount").value = button.dataset.walletAmount; pixComplete = false; render();
  }));
  $("wallet-card-number").addEventListener("input", () => {
    $("wallet-card-number").value = $("wallet-card-number").value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim(); render();
  });
  $("wallet-card-expiry").addEventListener("input", () => {
    $("wallet-card-expiry").value = $("wallet-card-expiry").value.replace(/\D/g, "").slice(0, 4).replace(/^(\d{2})(\d)/, "$1/$2"); render();
  });
  $("wallet-copy").addEventListener("click", async () => {
    const current = generation;
    try {
      await navigator.clipboard.writeText($("wallet-pix-key").value);
      if (current === generation) message("wallet-status", "Chave Pix copiada");
    } catch {
      if (current !== generation) return;
      $("wallet-pix-key").focus(); $("wallet-pix-key").select();
      message("wallet-status", "Selecione e copie a chave acima. A cópia automática não está disponível neste navegador.");
    }
  });
  render();
  return { setSession, refresh, open, accept };
}
