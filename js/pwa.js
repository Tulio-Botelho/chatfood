// Registra o service worker (exige HTTPS ou localhost) e oferece o botão "Instalar app".
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((err) => console.warn("Service worker não registrado:", err));
  });
}

let deferredPrompt = null;
const installBtn = () => document.getElementById("install-app");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  const btn = installBtn();
  if (btn) btn.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  const btn = installBtn();
  if (btn) btn.hidden = true;
});

document.addEventListener("DOMContentLoaded", () => {
  installBtn()?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn().hidden = true;
  });
});
