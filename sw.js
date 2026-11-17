// Só arquivos públicos entram no cache. Sessão, saldo, sacola e pedidos sempre vão ao servidor.
const RELEASE = /* asset-release */ "development";
const ASSETS = /* asset-versions */ {};
const CACHE = "foodagent-shell-" + RELEASE;
const MEDIA = "foodagent-media-v1";
const MEDIA_LIMIT = 80;
const MAX_MEDIA_BYTES = 512 * 1024;
const versioned = path => ASSETS[path] ? path + "?v=" + ASSETS[path] : path;

// Instala apenas a interface e a imagem do destaque. Fotos dos cardápios são guardadas sob demanda.
const SHELL = [
  "/", "/styles/main.css", "/styles/screens.css",
  "/js/app.js", "/js/api.js", "/js/assets.js", "/js/auth.js", "/js/chat.js",
  "/js/location.js", "/js/restaurants.js", "/js/security.js", "/js/history.js", "/js/sidebar.js",
  "/js/shopping.js", "/js/pwa.js", "/js/home.js", "/js/theme.js", "/js/wallet.js",
  "/js/ui.js", "/js/addresses.js", "/js/orders.js", "/js/gifts.js",
  "/js/delivery.js", "/js/delivery-map.js", "/js/delivery-timing.js",
  "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/pix-demo.svg",
  "/fonts/bricolage-grotesque-latin.woff2", "/fonts/inter-latin.woff2", "/img/hero-bonbons.jpg",
].map(versioned);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("foodagent-shell-") && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

let mediaWrites = Promise.resolve();
function remember(request, response, media) {
  const job = async () => {
    if (!response.ok || response.headers.get("Cache-Control")?.includes("no-store")) return;
    if (media) {
      const declared = Number(response.headers.get("Content-Length"));
      if (declared > MAX_MEDIA_BYTES || (await response.clone().arrayBuffer()).byteLength > MAX_MEDIA_BYTES) return;
    }
    const cache = await caches.open(media ? MEDIA : CACHE);
    await cache.put(request, response);
    if (media) {
      let keys = await cache.keys();
      const current = new URL(request.url || request, self.location.origin);
      await Promise.all(keys.filter(key => key.url !== current.href && new URL(key.url).pathname === current.pathname).map(key => cache.delete(key)));
      keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MEDIA_LIMIT)).map(key => cache.delete(key)));
    }
  };
  if (media) {
    mediaWrites = mediaWrites.then(job, job).catch(() => {});
    return mediaWrites;
  }
  return job().catch(() => {}); // Falta de espaço nunca impede abrir o site.
}

async function navigate(event) {
  let cache;
  try { cache = await caches.open(CACHE); } catch { /* continuar pela rede */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(event.request, { cache: "no-cache", signal: controller.signal });
    if (response.ok) event.waitUntil(remember("/", response.clone(), false));
    return response;
  } catch {
    return (cache && await cache.match("/")) || Response.error();
  } finally { clearTimeout(timer); }
}

self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate" && ["/", "/index.html"].includes(url.pathname)) {
    event.respondWith(navigate(event));
    return;
  }
  // URLs antigas ou desconhecidas seguem a rede; o servidor aponta para a versão correta.
  if (!ASSETS[url.pathname] || url.searchParams.get("v") !== ASSETS[url.pathname]) return;
  const media = /\.(?:jpe?g|png|webp|woff2|svg|ico)$/i.test(url.pathname);
  event.respondWith((async () => {
    let hit;
    try {
      const cache = await caches.open(media ? MEDIA : CACHE);
      hit = await cache.match(request) || (media && await (await caches.open(CACHE)).match(request));
    } catch { /* armazenamento indisponível: continuar pela rede */ }
    if (hit) return hit;
    const response = await fetch(request);
    event.waitUntil(remember(request, response.clone(), media));
    return response;
  })());
});
