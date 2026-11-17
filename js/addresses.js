// Tela "Onde entregar?": busca, localização atual, endereços salvos e confirmação.
import { geocode, getJson, updateShopping } from "./api.js";
import { LOCATION_ERRORS, requestBrowserLocation } from "./location.js";
import { $, node, openDialog } from "./ui.js";

const STORE_KEY = "foodagent.address.";

function splitNumber(line) {
  const parts = line.split(",").map((part) => part.trim()).filter(Boolean);
  const houseNumber = /^\d{1,6}[a-z]?(?:[-/]\d{1,6})?$/i;
  const index = parts.length > 1 && houseNumber.test(parts[0]) ? 0 : parts.length > 1 && houseNumber.test(parts[1]) ? 1 : -1;
  const number = index < 0 ? "" : parts.splice(index, 1)[0];
  return { line: parts.join(", "), number };
}

function fullAddress(street, number = "", complement = "") {
  const [road, ...area] = street.split(",").map((part) => part.trim()).filter(Boolean);
  return [road, number.trim(), ...area, complement.trim()].filter(Boolean).join(", ");
}

export function createAddresses({ getSession, refreshSession, onConfirm, onAuthError }) {
  const dialog = $("loc-dialog");
  let owner = null;
  let generation = 0;
  let saved = [];
  let selectedId = null;
  let candidate = null; // {lat, lon, line, source}
  let chosenLabel = "Casa";
  let demoLocations = [];
  let busy = false;
  let searchGeneration = 0;

  const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  const remember = () => { try { owner && storage()?.setItem(STORE_KEY + owner, selectedId || ""); } catch { /* sem storage */ } };
  const error = (text = "") => { $("loc-error").textContent = text; $("loc-error").hidden = !text; };

  const selected = () => saved.find((a) => a.id === selectedId) || null;
  const label = (a) => `${a.label} · ${a.line}`;
  const asLocation = (a) => ({ lat: a.lat, lon: a.lon, label: label(a), source: "manual" });
  const draftAddress = () => fullAddress($("loc-street").value.trim(), $("loc-number").value, $("loc-complement").value);

  function clearDraft() {
    candidate = null;
    for (const id of ["loc-street", "loc-number", "loc-complement"]) $(id).value = "";
  }

  function render() {
    $("loc-result").hidden = !candidate;
    if (candidate) $("loc-result-line").textContent = draftAddress();
    document.querySelectorAll("[data-addr-label]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.addrLabel === chosenLabel)));
    $("loc-saved-empty").hidden = saved.length > 0;
    $("loc-saved").replaceChildren(...saved.map((address) => {
      const item = node("li", "addr-item");
      const row = node("button", "addr-row");
      row.type = "button"; row.setAttribute("role", "radio");
      row.setAttribute("aria-checked", String(!candidate && address.id === selectedId));
      const icon = node("span", "addr-ico", address.label === "Trabalho" ? "💼" : address.label === "Casa" ? "🏠" : "📍");
      icon.setAttribute("aria-hidden", "true");
      const text = node("span", "addr-text");
      text.append(node("strong", null, address.label), node("small", null, address.line));
      const check = node("span", "addr-check", "✓");
      check.setAttribute("aria-hidden", "true");
      row.append(icon, text, check);
      row.addEventListener("click", () => { selectedId = address.id; clearDraft(); error(""); render(); });
      const del = node("button", "addr-del", "✕");
      del.type = "button"; del.setAttribute("aria-label", `Remover endereço ${address.label}`);
      del.addEventListener("click", () => remove(address));
      item.append(row, del);
      return item;
    }));
    dialog.querySelectorAll("input, select, button[type='button']").forEach((control) => { control.disabled = busy; });
    $("loc-confirm").disabled = busy || !(candidate ? $("loc-street").value.trim().length >= 3 : selected());
  }

  async function write(path, body) {
    const current = generation;
    await refreshSession();
    if (current !== generation) throw Object.assign(new Error("Conta alterada."), { stale: true });
    const data = await updateShopping(path, body, getSession().csrf_token);
    if (current !== generation) throw Object.assign(new Error("Conta alterada."), { stale: true });
    return data;
  }

  async function load() {
    if (!owner) return [];
    const current = generation;
    try {
      const data = await getJson("addresses");
      if (current !== generation) return [];
      saved = data.addresses || [];
      const stored = storage()?.getItem(STORE_KEY + owner);
      selectedId = saved.some((a) => a.id === stored) ? stored : selectedId && saved.some((a) => a.id === selectedId) ? selectedId : null;
      render();
    } catch { /* o erro aparece ao abrir a tela */ }
    return saved;
  }

  async function remove(address) {
    error("");
    try {
      const data = await write(`addresses/${address.id}/remove`, {});
      saved = data.addresses;
      if (selectedId === address.id) { selectedId = null; remember(); }
      render();
    } catch (e) { if (!e.stale) error(e.message); }
  }

  function setCandidate(next, query = "") {
    const found = splitNumber(next.line);
    const typed = splitNumber(query);
    candidate = { ...next, line: found.line, number: typed.number || found.number };
    $("loc-street").value = candidate.line;
    $("loc-number").value = candidate.number;
    $("loc-complement").value = "";
    error("");
    chosenLabel = saved.some((a) => a.label === "Casa") ? (saved.some((a) => a.label === "Trabalho") ? "Outro" : "Trabalho") : "Casa";
    render();
  }

  async function confirm() {
    const ownerId = owner;
    const current = generation;
    if (!ownerId || busy) return;
    error("");
    if (candidate) {
      const draft = { ...candidate };
      const street = $("loc-street").value.trim();
      const number = $("loc-number").value.trim();
      const line = draftAddress();
      const addressLabel = chosenLabel;
      if (street.length < 3) return error("Confira a rua, o bairro e a cidade do endereço.");
      if (line.length > 300) return error("O endereço completo deve ter até 300 caracteres. Abrevie a rua ou o complemento.");
      busy = true; render();
      try {
        let point = draft;
        if (draft.source !== "demo" && (street !== draft.line || (draft.source !== "browser" && number !== draft.number))) {
          const query = fullAddress(street, number);
          if (query.length > 200) throw new Error("Abrevie a rua, o bairro ou a cidade para localizar o número informado.");
          try {
            const { location } = await geocode(query);
            if (current !== generation) return;
            point = { ...location, source: "manual" };
          } catch (e) {
            // Nem toda porta existe no mapa: mantém a rua já encontrada e o número informado.
            if (e.status !== 404 || street !== draft.line) throw e;
          }
        }
        if (current !== generation) return;
        const data = await write("addresses", { label: addressLabel, line, lat: point.lat, lon: point.lon });
        if (current !== generation) return;
        saved = data.addresses;
        const address = saved.find((a) => a.label === addressLabel && a.line === line);
        if (!address) throw new Error("Não foi possível confirmar o endereço salvo. Tente novamente.");
        selectedId = address.id; clearDraft(); remember(); render();
        onConfirm({ ...asLocation(address), source: point.source || "manual" }, ownerId);
      } catch (e) { if (current === generation && !e.stale) error(e.message); }
      finally { if (current === generation) { busy = false; render(); } }
      return;
    }
    const address = selected();
    if (address) { remember(); onConfirm(asLocation(address), ownerId); }
  }

  // ---- eventos da tela ----
  $("loc-browser").addEventListener("click", async () => {
    if (busy) return;
    const current = generation;
    busy = true; clearDraft(); error(""); render();
    try {
      const loc = await requestBrowserLocation();
      if (current !== generation) return;
      setCandidate({ lat: loc.lat, lon: loc.lon, line: "Minha localização atual", source: "browser" });
    } catch (e) { if (current === generation) error(LOCATION_ERRORS[e.code] || LOCATION_ERRORS.unavailable); }
    finally { if (current === generation) { busy = false; render(); } }
  });
  $("loc-search").addEventListener("click", async () => {
    if (busy) return;
    const q = $("loc-address").value.trim();
    if (q.length < 3) return error("Digite pelo menos 3 caracteres.");
    const current = generation, request = ++searchGeneration;
    busy = true; clearDraft(); error(""); render();
    try {
      const { location } = await geocode(q);
      if (current !== generation || request !== searchGeneration) return;
      setCandidate({ lat: location.lat, lon: location.lon, line: location.label || q, source: location.source || "manual" }, q);
    } catch (e) { if (current === generation) { if (e.status === 401) onAuthError?.(e); else error(e.message); } }
    finally { if (current === generation) { busy = false; render(); } }
  });
  $("loc-address").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("loc-search").click(); } });
  $("loc-demo-select").addEventListener("change", (e) => {
    const d = demoLocations.find((x) => x.id === e.target.value);
    if (d) setCandidate({ lat: d.lat, lon: d.lon, line: `${d.label} (teste)`, source: "demo" });
  });
  document.querySelectorAll("[data-addr-label]").forEach((chip) => chip.addEventListener("click", () => { chosenLabel = chip.dataset.addrLabel; render(); }));
  $("loc-confirm").addEventListener("click", confirm);
  for (const id of ["loc-street", "loc-number", "loc-complement"]) {
    $(id).addEventListener("input", () => { error(""); render(); });
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); if (!$("loc-confirm").disabled) void confirm(); }
    });
  }

  return {
    selected, label, asLocation, load, remove,
    list: () => saved,
    setDemoLocations(list) { demoLocations = list || []; },
    setOwner(userId) {
      if (userId === owner) return;
      owner = userId; generation++; searchGeneration++; busy = false; saved = []; selectedId = null; clearDraft(); error("");
      $("loc-address").value = "";
      if (dialog.open) dialog.close();
      render();
    },
    open(message) {
      error(message || ""); clearDraft();
      $("loc-demo").hidden = !demoLocations.length;
      const option = (text, value) => Object.assign(document.createElement("option"), { textContent: text, value });
      $("loc-demo-select").replaceChildren(option("Selecione…", ""), ...demoLocations.map((d) => option(d.label, d.id)));
      render();
      openDialog(dialog);
      load();
    },
    close() { if (dialog.open) dialog.close(); },
    error,
    get isOpen() { return dialog.open; },
  };
}
