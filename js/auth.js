import { authenticate, getAuthSession, setSessionToken, setSessionRecovery } from "./api.js";
import { createEmailCodeForm, createSecuritySettings } from "./security.js";
import { openDialog } from "./ui.js";

const $ = (id) => document.getElementById(id);
let googleScript;

function loadGoogle() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google.accounts.id);
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => fail(), 15000);
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        googleScript = null;
        reject(new Error("Não consegui carregar o Google. Verifique sua conexão e tente abrir o formulário novamente."));
      };
      script.src = "https://accounts.google.com/gsi/client?hl=pt-BR";
      script.async = true;
      script.onload = () => {
        clearTimeout(timeout);
        if (!globalThis.google?.accounts?.id) return fail();
        resolve(globalThis.google.accounts.id);
      };
      script.onerror = fail;
      document.head.append(script);
    });
  }
  return googleScript;
}

export async function initAuth({ onSessionChange = () => {} } = {}) {
  let session = null;
  let refreshedAt = null, refreshInFlight = null, sessionRevision = 0;
  const SESSION_FRESH_MS = 30_000;
  setSessionToken(null);
  let mode = "login";
  let busy = false;
  let opening = false;
  let googleNonce = null;
  let security = null;
  let loginCodeForm = null;
  const dialog = $("auth-dialog");
  const error = (message) => {
    $("auth-error").textContent = message || "";
    $("auth-error").hidden = !message;
  };
  const setBusy = (value) => {
    busy = value;
    $("auth-fields").disabled = value || !session;
    $("auth-tab-login").disabled = value;
    $("auth-tab-register").disabled = value;
    $("auth-logout").disabled = value;
    $("auth-google-button").inert = value;
    $("auth-submit").textContent = value ? "Aguarde…" : mode === "register" ? "Criar minha conta" : "Entrar";
    loginCodeForm?.setBusy(value);
    security?.setBusy(value);
  };

  const userListeners = new Set();

  function applySession(data, reason = "refresh") {
    session = data;
    sessionRevision++; refreshedAt = Date.now();
    setSessionToken(data.csrf_token);
    const user = session.user;
    userListeners.forEach((fn) => fn(user || null));
    $("account-name").textContent = user?.name || "";
    $("account-name").hidden = !user;
    $("auth-open").hidden = !!user;
    $("auth-logout").hidden = !user;
    $("account-status").hidden = true;
    renderLoginState();
    security?.render();
    onSessionChange(data, reason);
    try { if (reason !== "refresh") channel?.postMessage({ type: "session-changed" }); } catch { /* o foco da janela também sincroniza a conta */ }
  }

  function renderLoginState() {
    const challenge = session?.email_challenge?.purpose === "login" ? session.email_challenge : null;
    $("auth-form").hidden = !!challenge;
    document.querySelector(".auth-tabs").hidden = !!challenge;
    $("auth-switch").closest("p").hidden = !!challenge;
    if (challenge) {
      $("auth-title").textContent = "Confirme seu acesso";
      $("auth-description").textContent = "Digite o código recebido por e-mail para entrar na sua conta.";
      $("auth-google-section").hidden = true;
      $("auth-google-unavailable").hidden = true;
    }
    loginCodeForm?.render(challenge);
  }

  function setMode(value) {
    mode = value;
    const register = mode === "register";
    $("auth-title").textContent = register ? "Crie sua conta" : "Bem-vindo ao FoodAgent";
    $("auth-description").textContent = register ? "Descubra sua próxima comida favorita." : "Entre na sua conta para continuar.";
    $("auth-tab-login").setAttribute("aria-pressed", String(!register));
    $("auth-tab-register").setAttribute("aria-pressed", String(register));
    $("auth-name-field").hidden = !register;
    $("auth-name").required = register;
    $("auth-name").disabled = !register;
    $("auth-password").minLength = register ? 8 : 1;
    $("auth-password").autocomplete = register ? "new-password" : "current-password";
    $("auth-password").value = "";
    $("auth-password-hint").textContent = register ? "Crie uma senha com 8 a 128 caracteres." : "Use a senha da sua conta FoodAgent.";
    $("auth-switch-text").textContent = register ? "Já tem conta?" : "Não tem conta?";
    $("auth-switch").textContent = register ? "Entrar" : "Criar conta";
    $("auth-submit").textContent = register ? "Criar minha conta" : "Entrar";
    error("");
    setBusy(false);
  }

  async function performAction(action, payload) {
    if (busy || !session) throw new Error("Aguarde a operação atual terminar.");
    setBusy(true);
    try {
      const result = await authenticate(action, payload, session.csrf_token);
      applySession(result, action);
      return result;
    } catch (e) {
      // Recupera tentativas, expiração e o cookie pendente quando o envio falha.
      try { await refreshSession(); } catch { /* preservar o erro original */ }
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function submit(action, payload) {
    if (busy || !session) return;
    error("");
    try {
      await performAction(action, payload);
      $("auth-form").reset();
      if (session.email_challenge?.purpose !== "login") dialog.close();
    } catch (e) { error(e.message); }
  }

  async function refreshSession({ force = true } = {}) {
    if (!force && session && refreshedAt !== null && Date.now() - refreshedAt < SESSION_FRESH_MS) return session;
    if (!refreshInFlight) {
      const revision = sessionRevision;
      refreshInFlight = getAuthSession().then(data => {
        if (revision === sessionRevision) applySession(data);
        return session;
      }).finally(() => { refreshInFlight = null; setBusy(busy); });
    }
    const result = await refreshInFlight;
    // Uma troca de conta ocorrida durante a consulta invalida a resposta antiga.
    if (refreshedAt === null) return refreshSession();
    return result;
  }

  const ensureSession = () => refreshSession({ force: false });
  function invalidateSession() { refreshedAt = null; sessionRevision++; }
  let channel = null;
  try { if (typeof window.BroadcastChannel === "function") channel = new window.BroadcastChannel("foodagent-auth"); } catch { /* indisponível neste navegador */ }
  function syncSession(changed = false) {
    if (changed || !refreshInFlight || refreshedAt !== null) invalidateSession();
    return refreshSession();
  }
  if (channel) channel.onmessage = event => { if (event.data?.type === "session-changed") void syncSession(true).catch(() => {}); };
  window.addEventListener("focus", () => { void syncSession().catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void syncSession().catch(() => {}); });
  setSessionRecovery(async token => {
    if (token && session?.csrf_token !== token) return;
    await syncSession();
  });

  async function renderGoogle() {
    const enabled = !!session?.google_client_id;
    $("auth-google-section").hidden = !enabled;
    $("auth-google-unavailable").hidden = enabled;
    if (!enabled) return;
    const google = await loadGoogle();
    if (!dialog.open || session?.email_challenge?.purpose === "login") return;
    if (googleNonce !== session.google_nonce) {
      google.initialize({
        client_id: session.google_client_id, nonce: session.google_nonce,
        auto_select: false, ux_mode: "popup",
        callback: ({ credential }) => {
          if (dialog.open && credential) submit("google", { credential });
        },
      });
      googleNonce = session.google_nonce;
    }
    $("auth-google-button").replaceChildren();
    google.renderButton($("auth-google-button"), {
      theme: "outline", size: "large", text: "continue_with", shape: "pill",
      width: Math.min(340, Math.max(200, dialog.clientWidth - 48)), locale: "pt-BR",
    });
  }

  async function open() {
    if (opening || busy) return;
    opening = true;
    error("");
    openDialog(dialog);
    $("auth-loading").hidden = false;
    $("auth-fields").disabled = true;
    $("auth-google-button").replaceChildren();
    try {
      await ensureSession();
      if (session.user) { dialog.close(); return; }
      if (session.email_challenge?.purpose === "login") return;
      setMode(mode);
      opening = false;
      $("auth-loading").hidden = true;
      await renderGoogle();
    } catch (e) {
      error(e.message);
    } finally {
      opening = false;
      $("auth-loading").hidden = true;
      if (!busy) setBusy(false);
    }
  }

  $("auth-open").addEventListener("click", open);
  $("auth-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { $("auth-password").value = ""; $("auth-code-input").value = ""; });
  $("auth-switch").addEventListener("click", () => setMode(mode === "register" ? "login" : "register"));
  $("auth-show-password").addEventListener("click", () => {
    const show = $("auth-password").type === "password";
    $("auth-password").type = show ? "text" : "password";
    $("auth-show-password").textContent = show ? "Ocultar" : "Mostrar";
    $("auth-show-password").setAttribute("aria-pressed", String(show));
  });
  $("auth-tab-login").addEventListener("click", () => setMode("login"));
  $("auth-tab-register").addEventListener("click", () => setMode("register"));
  $("auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const body = { email: $("auth-email").value.trim(), password: $("auth-password").value };
    if (mode === "register") body.name = $("auth-name").value.trim();
    submit(mode, body);
  });
  $("auth-logout").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    $("account-status").hidden = true;
    try {
      // Atualiza o CSRF se outra aba tiver renovado a sessão.
      const latest = await refreshSession();
      applySession(await authenticate("logout", {}, latest.csrf_token), "logout");
      globalThis.google?.accounts?.id?.disableAutoSelect();
    } catch (e) {
      $("account-status").textContent = e.message;
      $("account-status").hidden = false;
    } finally { setBusy(false); }
  });

  loginCodeForm = createEmailCodeForm("auth", {
    performAction, showError: error,
    onSuccess: () => { dialog.close(); $("auth-form").reset(); },
    onCancel: () => {
      setMode("login");
      renderLoginState();
      renderGoogle().catch((e) => error(e.message));
    },
  });
  security = createSecuritySettings({ getSession: () => session, refreshSession, performAction, openLogin: open });

  setMode("login");
  try {
    await refreshSession();
    if (session.email_challenge?.purpose === "login") openDialog(dialog);
  } catch { /* Tentar novamente ao abrir. */ }
  return {
    open, refreshSession, ensureSession, getSession: () => session,
    getUser: () => session?.user || null,
    onUserChange: (fn) => userListeners.add(fn),
  };
}
