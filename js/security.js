import { openDialog } from "./ui.js";

const $ = (id) => document.getElementById(id);

// O mesmo componente controla a confirmação de login e a alteração da preferência.
export function createEmailCodeForm(prefix, { performAction, onSuccess, onCancel, showError }) {
  let challenge = null;
  let busy = false;
  let timer = null;
  function update() {
    if (!challenge) return;
    const now = Math.floor(Date.now() / 1000);
    const wait = Math.max(0, challenge.resend_after - now);
    const expired = challenge.expires_at <= now;
    const locked = challenge.attempts_remaining <= 0;
    $(`${prefix}-code-fields`).disabled = busy || !challenge.ready || expired || locked;
    $(`${prefix}-code-resend`).disabled = busy || wait > 0 || locked;
    $(`${prefix}-code-cancel`).disabled = busy;
    $(`${prefix}-code-resend`).textContent = wait > 0 ? `Reenviar em ${wait}s` : "Reenviar código";
    $(`${prefix}-code-status`).textContent = locked ? "Limite de tentativas atingido. Cancele e inicie novamente."
      : !challenge.ready ? "O envio não foi concluído. Aguarde para reenviar o código."
      : expired ? "Código expirado. Solicite um novo código."
      : `O código expira em ${Math.ceil((challenge.expires_at - now) / 60)} min e só pode ser usado uma vez.`;
  }
  async function action(name, payload, callback) {
    if (busy) return;
    showError("");
    try {
      const result = await performAction(name, payload);
      $(`${prefix}-code-input`).value = "";
      callback?.(result);
    } catch (e) { showError(e.message); }
  }
  $(`${prefix}-code-form`).addEventListener("submit", (event) => {
    event.preventDefault();
    const code = $(`${prefix}-code-input`).value.trim();
    if (!/^[0-9]{6}$/.test(code)) { showError("Digite o código de 6 dígitos recebido por e-mail."); return; }
    action("email/verify", { code }, onSuccess);
  });
  $(`${prefix}-code-resend`).addEventListener("click", () => action("email/resend", {}));
  $(`${prefix}-code-cancel`).addEventListener("click", () => action("email/cancel", {}, onCancel));
  return {
    setBusy(value) { busy = value; update(); },
    render(value) {
      challenge = value;
      $(`${prefix}-code`).hidden = !challenge;
      if (timer) { clearInterval(timer); timer = null; }
      if (!challenge) { $(`${prefix}-code-input`).value = ""; return; }
      const purpose = challenge.purpose === "enable" ? "ativar a verificação"
        : challenge.purpose === "disable" ? "desativar a verificação" : "concluir seu login";
      $(`${prefix}-code-description`).textContent = `Confirme o código enviado para ${challenge.email_hint} para ${purpose}.`;
      update();
      timer = setInterval(update, 1000);
      timer.unref?.();
    },
  };
}

export function createSecuritySettings({ getSession, refreshSession, performAction, openLogin }) {
  let busy = false;
  let loading = false;
  let passwordOwner = null;
  const dialog = $("settings-dialog");
  const error = (message) => {
    $("security-error").textContent = message || "";
    $("security-error").hidden = !message;
  };
  const passwordError = (message) => {
    $("security-password-error").textContent = message || "";
    $("security-password-error").hidden = !message;
  };
  const codeForm = createEmailCodeForm("security", {
    performAction, showError: error,
    onSuccess: (data) => {
      $("security-message").textContent = data.user?.email_2fa_enabled
        ? "Verificação em duas etapas ativada. Você receberá um código em todo novo login."
        : "Verificação em duas etapas desativada.";
      $("security-message").hidden = false;
    },
    onCancel: () => { $("security-message").hidden = true; },
  });
  function render() {
    const session = getSession();
    const user = session?.user;
    const enabled = !!user?.email_2fa_enabled;
    const canChangePassword = user?.provider === "email";
    if (passwordOwner !== (user?.id || null)) {
      passwordOwner = user?.id || null;
      $("security-password-form").reset();
      $("security-password-message").hidden = true;
      passwordError("");
    }
    $("security-guest").hidden = !!user;
    $("security-account").hidden = !user;
    $("security-email").textContent = user?.email || "";
    $("security-status").textContent = enabled ? "Ativada" : "Desativada";
    $("security-status").classList.toggle("enabled", enabled);
    $("security-toggle").setAttribute("aria-checked", String(enabled));
    $("security-toggle").disabled = busy || loading || !user || !session?.email_2fa_available || !!session?.email_challenge;
    $("security-login").disabled = busy || loading;
    $("security-unavailable").hidden = !!session?.email_2fa_available;
    $("security-password-form").hidden = !canChangePassword;
    $("security-password-google").hidden = !user || canChangePassword;
    $("security-password-fields").disabled = busy || loading || !canChangePassword || !!session?.email_challenge;
    $("security-password-submit").textContent = busy ? "Aguarde…" : "Salvar nova senha";
    $("security-password-pending").hidden = !canChangePassword || !session?.email_challenge;
    codeForm.render(session?.email_challenge?.purpose !== "login" ? session?.email_challenge : null);
    codeForm.setBusy(busy);
  }
  async function open() {
    if (busy) return;
    error("");
    passwordError("");
    $("security-password-message").hidden = true;
    $("security-message").hidden = true;
    loading = true;
    render();
    openDialog(dialog);
    try { await refreshSession(); }
    catch (e) { error(e.message); }
    finally { loading = false; render(); }
  }
  $("settings-open").addEventListener("click", open);
  $("settings-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    $("security-code-input").value = "";
    $("security-password-form").reset();
    passwordError("");
  });
  $("security-login").addEventListener("click", () => { dialog.close(); openLogin(); });
  $("security-toggle").addEventListener("click", async () => {
    if (busy || !getSession()?.user) return;
    error("");
    $("security-message").hidden = true;
    try { await performAction("email/start", { enabled: !getSession().user.email_2fa_enabled }); }
    catch (e) { error(e.message); }
  });
  $("security-password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || loading || !getSession()?.user || getSession().email_challenge) return;
    passwordError("");
    $("security-password-message").hidden = true;
    const current = $("security-current-password").value;
    const next = $("security-new-password").value;
    const confirmation = $("security-confirm-password").value;
    if (!current || current.length > 128 || next.length < 8 || next.length > 128) {
      passwordError("Informe sua senha atual e uma nova senha de 8 a 128 caracteres."); return;
    }
    if (next !== confirmation) { passwordError("A confirmação não corresponde à nova senha."); return; }
    if (current === next) { passwordError("Escolha uma nova senha diferente da senha atual."); return; }
    try {
      await performAction("password/change", { current_password: current, new_password: next, confirm_password: confirmation });
      $("security-password-form").reset();
      $("security-password-message").textContent = "Senha alterada. Você continua conectado; os outros acessos foram encerrados.";
      $("security-password-message").hidden = false;
    } catch (e) { passwordError(e.message); }
  });
  render();
  return { render, open, setBusy(value) { busy = value; render(); } };
}
