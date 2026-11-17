// Mapa claro com trajeto restante e moto 3D. Falhas não interrompem o acompanhamento.
import { assetUrl } from "./assets.js";
let leafletPromise;
export function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    css.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="; css.crossOrigin = "anonymous";
    document.head.append(css);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="; script.crossOrigin = "anonymous";
    const timer = setTimeout(() => fail(), 12000);
    function fail() {
      clearTimeout(timer); script.remove(); css.remove(); leafletPromise = null;
      reject(new Error("Mapa indisponível. Verifique sua conexão e tente novamente."));
    }
    script.onerror = fail;
    script.onload = () => { clearTimeout(timer); globalThis.L ? resolve(globalThis.L) : fail(); };
    document.head.append(script);
  });
  return leafletPromise;
}

function distance(a, b) {
  const rad = Math.PI / 180;
  const lat = (b[1] - a[1]) * rad, lon = (b[0] - a[0]) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(lon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function routePath(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]));
  return { points, cumulative, length: cumulative.at(-1) };
}

export function pointOnRoute(path, progress) {
  const { points, cumulative, length } = path;
  const target = Math.max(0, Math.min(1, progress)) * length;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < target) i++;
  const ratio = (target - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1);
  return [points[i - 1][1] + (points[i][1] - points[i - 1][1]) * ratio,
    points[i - 1][0] + (points[i][0] - points[i - 1][0]) * ratio];
}

export function remainingRoute(path, progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped === 1) return [];
  const target = clamped * path.length;
  let index = 1;
  while (index < path.points.length && path.cumulative[index] <= target) index++;
  return [pointOnRoute(path, clamped), ...path.points.slice(index).map(([lon, lat]) => [lat, lon])];
}

export function headingOnRoute(path, progress) {
  const start = pointOnRoute(path, Math.max(0, Math.min(.995, progress)));
  const end = pointOnRoute(path, Math.min(1, Math.max(0, progress) + .005));
  const east = (end[1] - start[1]) * Math.cos(start[0] * Math.PI / 180);
  return Math.atan2(east, end[0] - start[0]) * 180 / Math.PI;
}

export async function buildDeliveryMap(container, tracking) {
  if (!container.isConnected) return null;
  container.classList.add("delivery-map-surface");
  if (!tracking.external_maps) {
    const local = document.createElement("div"); local.className = "delivery-local-map";
    for (const [symbol, name, point] of [["🍽️", tracking.origin.name, tracking.origin], ["📍", tracking.destination.label || "Destino confirmado", tracking.destination]]) {
      const pin = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = `${symbol} ${name}`;
      const coordinates = document.createElement("small"); coordinates.textContent = `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
      pin.append(title, coordinates); local.append(pin);
    }
    const caption = document.createElement("p"); caption.textContent = "Origem e destino · visualização local, sem trajeto pelas ruas.";
    local.append(caption); container.append(local);
    return { update() {}, resize() {}, destroy() { local.remove(); } };
  }
  const L = await loadLeaflet();
  if (!container.isConnected) return null;
  const map = L.map(container, { scrollWheelZoom: false, zoomSnap: .5 });
  const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, opacity: .5, className: "delivery-map-tiles", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  tiles.on("tileerror", () => container.dispatchEvent(new (container.ownerDocument.defaultView.Event)("maptileserror", { bubbles: true })));
  const marker = (point, kind, label) => {
    const shape = kind === "destination" ? '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>'
      : '<path d="M4 10h16l-2-6H6l-2 6ZM5 10v10h14V10M9 20v-6h6v6M3 10c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0"/>';
    const html = `<span class="delivery-location-symbol ${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shape}</svg></span>`;
    const icon = L.divIcon({ className: "delivery-map-pin", html, iconSize: [38, 38], iconAnchor: [19, 19] });
    const text = document.createElement("span"); text.textContent = label;
    return L.marker([point.lat, point.lon], { icon, title: label, alt: label }).addTo(map).bindPopup(text);
  };
  const origin = tracking.origin, destination = tracking.destination;
  marker(origin, "origin", origin.name + (origin.is_simulated && origin.source !== "gift" ? " (fictício)" : ""));
  marker(destination, "destination", destination.label || "Destino confirmado");
  let courier = null, path = null, route = null, casing = null;
  const bounds = [[origin.lat, origin.lon], [destination.lat, destination.lon]];
  if (tracking.route.status === "ready") {
    path = routePath(tracking.route.coordinates);
    const points = tracking.route.coordinates.map(([lon, lat]) => [lat, lon]);
    casing = L.polyline(points, { color: "#ffffff", weight: 10, opacity: .95, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    route = L.polyline(points, { color: "#ff5a36", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    bounds.push(...points);
    const icon = L.divIcon({ className: "delivery-courier", html: `<span class="delivery-courier-shadow"></span><span class="delivery-courier-body"><img src="${assetUrl("/img/courier-3d.png")}" alt="" draggable="false"></span>`, iconSize: [76, 76], iconAnchor: [38, 38] });
    courier = L.marker([origin.lat, origin.lon], { icon, title: "Entregador", alt: "Entregador", zIndexOffset: 1000, keyboard: false, interactive: false }).addTo(map);
  }
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let following = true, destroyed = false, frame = null, lastProgress = null, rotation = null, nextPan = 0;
  const requestFrame = container.ownerDocument.defaultView.requestAnimationFrame?.bind(container.ownerDocument.defaultView);
  const cancelFrame = container.ownerDocument.defaultView.cancelAnimationFrame?.bind(container.ownerDocument.defaultView);
  let followControl = null;
  function setFollowing(value) {
    following = value;
    if (!followControl) return;
    followControl.classList.toggle("following", value);
    followControl.setAttribute("aria-pressed", String(value));
    followControl.title = value ? "Acompanhando o entregador" : "Voltar a acompanhar o entregador";
    followControl.setAttribute("aria-label", followControl.title);
  }
  if (courier) {
    followControl = document.createElement("button"); followControl.type = "button";
    followControl.className = "delivery-follow-control";
    followControl.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';
    L.DomEvent?.disableClickPropagation(followControl);
    L.DomEvent?.disableScrollPropagation(followControl);
    followControl.addEventListener("click", () => {
      setFollowing(true);
      map.panTo(pointOnRoute(path, lastProgress ?? 0), { animate: !reducedMotion, duration: .8 });
    });
    container.append(followControl);
    map.on("dragstart zoomstart", () => setFollowing(false));
    setFollowing(true);
  }
  function paint(progress) {
    if (destroyed || !courier) return;
    lastProgress = progress;
    const point = pointOnRoute(path, progress);
    courier.setLatLng(point);
    const remaining = remainingRoute(path, progress);
    route.setLatLngs(remaining); casing.setLatLngs(remaining);
    const heading = headingOnRoute(path, progress);
    rotation = rotation === null ? heading : rotation + (((heading - rotation) % 360 + 540) % 360) - 180;
    const body = courier.getElement?.()?.querySelector(".delivery-courier-body");
    if (body) body.style.transform = `rotate(${rotation}deg)`;
    const now = performance.now();
    if (following && now >= nextPan) {
      nextPan = now + 1100;
      map.panInside(point, { paddingTopLeft: [66, 58], paddingBottomRight: [66, 58], animate: !reducedMotion, duration: .8 });
    }
  }
  return {
    update(progress) {
      if (destroyed || !courier) return;
      if (frame !== null) { cancelFrame?.(frame); frame = null; }
      const target = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      if (lastProgress === null || reducedMotion || !requestFrame || target <= lastProgress || target - lastProgress > .08) { paint(target); return; }
      const start = lastProgress, began = performance.now();
      const animate = (now) => {
        if (destroyed) return;
        const elapsed = Math.min(1, (now - began) / 1000);
        paint(start + (target - start) * elapsed);
        frame = elapsed < 1 ? requestFrame(animate) : null;
      };
      frame = requestFrame(animate);
    },
    resize() { map.invalidateSize(); },
    destroy() { destroyed = true; if (frame !== null) cancelFrame?.(frame); followControl?.remove(); map.remove(); },
  };
}
