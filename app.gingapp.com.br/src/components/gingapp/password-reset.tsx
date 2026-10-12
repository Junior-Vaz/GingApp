import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Loader2, Mail, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  RESET_PASSWORD_NO_TOKEN,
  RESET_PASSWORD_SUCCESS,
  forgotPasswordErrorMessage,
  requestPasswordReset,
  resetPassword,
  resetPasswordErrorMessage,
  validateResetPassword,
  type ResetPasswordErrors,
} from "@/lib/password-reset";
import { newPasswordRules } from "@/lib/password";
import { Brand } from "./app-shell";
import { PasswordField } from "./change-password";

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 bg-background px-4 py-10">
      <Link to="/login" search={{ redirect: undefined }} className="no-underline">
        <Brand />
      </Link>
      <main className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-extrabold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function BackToLogin() {
  return (
    <Link to="/login" search={{ redirect: undefined }} className="mt-6 block text-center text-sm underline">
      Voltar ao login
    </Link>
  );
}

/** /esqueci-senha (pública): pede o link por e-mail. Depois de enviar mostra SEMPRE a mesma mensagem neutra. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState("");
  const [showSlug, setShowSlug] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Informe seu e-mail.");
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(email, slug);
      setSent(true);
    } catch (err) {
      setError(forgotPasswordErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Frame title="Esqueci minha senha">
        <p className="mt-4 flex items-start gap-2 text-sm" role="status" data-testid="forgot-neutral">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>{FORGOT_PASSWORD_NEUTRAL_MESSAGE}</span>
        </p>
        <BackToLogin />
      </Frame>
    );
  }

  return (
    <Frame title="Esqueci minha senha">
      <p className="mt-1 text-sm text-muted-foreground">Informe o e-mail da sua conta para receber o link de redefinição.</p>
      <form onSubmit={submit} noValidate>
        <label className="login-label" htmlFor="forgot-email">
          E-mail
        </label>
        <div className="login-field">
          <Mail className="login-icon" aria-hidden />
          <input
            id="forgot-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="voce@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {showSlug || slug ? (
          <>
            <label className="login-label" htmlFor="forgot-slug">
              Código do grupo
            </label>
            <div className="login-field">
              <Users className="login-icon" aria-hidden />
              <input
                id="forgot-slug"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ex.: grupo-semente"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </>
        ) : (
          <button type="button" className="mt-4 w-full py-1 text-sm text-muted-foreground underline" onClick={() => setShowSlug(true)}>
            Pertenço a mais de um grupo
          </button>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <Button className="mt-6 h-12 w-full text-base" type="submit" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Enviando…" : "Enviar link"}
        </Button>
      </form>
      <BackToLogin />
    </Frame>
  );
}

/**
 * /redefinir-senha?token=... (pública): define a nova senha. O token é lido da query e REMOVIDO da URL
 * (replace) logo na montagem - fica só em memória, longe do histórico, de favoritos e do Referer.
 */
export function ResetPasswordPage({ token: tokenFromUrl }: { token: string | undefined }) {
  const navigate = useNavigate();
  const [token] = useState(() => tokenFromUrl?.trim() ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<ResetPasswordErrors>({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (tokenFromUrl !== undefined) {
      void navigate({ to: "/redefinir-senha", search: { token: undefined }, replace: true });
    }
    // Só na montagem: o token já foi capturado no estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setServerError("");
    const found = validateResetPassword({ newPassword, confirmPassword });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setLoading(true);
    try {
      await resetPassword(token, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch (err) {
      setServerError(resetPasswordErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <Frame title="Redefinir senha">
        <p className="mt-4 flex items-start gap-2 text-sm" role="status" data-testid="reset-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>{RESET_PASSWORD_SUCCESS}</span>
        </p>
        <Link to="/login" search={{ redirect: undefined }} className="mt-6 block">
          <Button className="h-12 w-full text-base" tabIndex={-1}>
            Ir para o login
          </Button>
        </Link>
      </Frame>
    );
  }

  if (!token) {
    return (
      <Frame title="Redefinir senha">
        <ErrorBox>{RESET_PASSWORD_NO_TOKEN}</ErrorBox>
        <Link to="/esqueci-senha" className="mt-6 block text-center text-sm underline">
          Pedir um novo link
        </Link>
        <BackToLogin />
      </Frame>
    );
  }

  return (
    <Frame title="Redefinir senha">
      <p className="mt-1 text-sm text-muted-foreground">Escolha a nova senha da sua conta.</p>
      <form onSubmit={submit} noValidate>
        <PasswordField
          id="resetNewPassword"
          label="Nova senha"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          error={errors.newPassword}
        />
        <PasswordField
          id="resetConfirmPassword"
          label="Confirmar nova senha"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errors.confirmPassword}
        />
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground" aria-label="Requisitos da nova senha">
          {newPasswordRules(newPassword, "")
            .filter((rule) => rule.id === "length" || rule.id === "bytes")
            .map((rule) => (
              <li key={rule.id} data-ok={rule.ok} className={rule.ok ? "text-foreground" : undefined}>
                {rule.label}
              </li>
            ))}
        </ul>

        {serverError && <ErrorBox>{serverError}</ErrorBox>}

        <Button className="mt-6 h-12 w-full text-base" type="submit" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Salvando…" : "Redefinir senha"}
        </Button>
      </form>
      {serverError && (
        <Link to="/esqueci-senha" className="mt-4 block text-center text-sm underline">
          Pedir um novo link
        </Link>
      )}
      <BackToLogin />
    </Frame>
  );
}
