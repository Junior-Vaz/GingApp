import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CalendarCheck, Eye, EyeOff, KeyRound, Loader2, LogIn, Lock, Mail, Medal, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isChallengeExpired, login, verifyTwoFactor, type TwoFactorProof } from "@/lib/auth";
import { cleanTotpCode, TOTP_CODE_LENGTH } from "@/lib/two-factor";
import { usePasswordResetEnabled } from "@/lib/password-reset";
import { LegalLinks } from "./legal";
import rodaImage from "@/assets/capoeira-roda.jpg";

const HIGHLIGHTS = [
  { icon: CalendarCheck, text: "Aulas, frequência e financeiro num só lugar" },
  { icon: Medal, text: "Graduações, certificados e passaporte" },
  { icon: Users, text: "Rodas, eventos e a comunidade do seu grupo" },
];

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [slug, setSlug] = useState("");
  const [needsSlug, setNeedsSlug] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 2FA (segundo passo): o desafio vive só em memória; some ao voltar, expirar ou recarregar a página.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const resetByEmail = usePasswordResetEnabled();

  async function goAfterLogin() {
    // `redirect` só aceita caminhos internos (evita open redirect).
    const target = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
    await navigate({ to: target });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    setLoading(true);
    try {
      const result = await login({ email, password, organizationSlug: slug });
      if (result.status === "twoFactor") {
        setChallengeToken(result.challengeToken);
        setPassword(""); // a senha não precisa ficar na memória durante o segundo passo
        return;
      }
      await goAfterLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível entrar.";
      if (/organizationSlug|múltiplas organiza/i.test(message)) setNeedsSlug(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials(message = "") {
    setChallengeToken(null);
    setUseRecovery(false);
    setCode("");
    setRecoveryCode("");
    setError(message);
  }

  async function submitTwoFactor(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!challengeToken) return;
    const proof: TwoFactorProof = useRecovery ? { recoveryCode: recoveryCode.trim() } : { code };
    if ("recoveryCode" in proof ? proof.recoveryCode === "" : proof.code.length !== TOTP_CODE_LENGTH) {
      setError("recoveryCode" in proof ? "Informe o código de recuperação." : `Informe o código de ${TOTP_CODE_LENGTH} dígitos.`);
      return;
    }
    setLoading(true);
    try {
      await verifyTwoFactor(challengeToken, proof);
      await goAfterLogin();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível verificar o código.";
      // Desafio vencido: não adianta tentar de novo - volta ao e-mail/senha.
      if (isChallengeExpired(err)) backToCredentials(message);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Painel de marca: banner no topo no celular, coluna inteira no desktop. */}
      <aside
        className="relative flex flex-col justify-between overflow-hidden bg-primary px-6 pb-14 pt-[max(1.75rem,env(safe-area-inset-top))] text-primary-foreground lg:px-14 lg:pb-12 lg:pt-12"
        style={{ backgroundImage: `url(${rodaImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      >
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, oklch(.16 .035 155 / .78), oklch(.2 .045 158 / .88))" }}
          aria-hidden
        />
        <div className="relative z-10">
          <span className="inline-flex rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg">
            <img src="/logo.png" alt="GingApp" className="h-9 w-auto object-contain lg:h-11" />
          </span>
        </div>
        <div className="relative z-10 mt-8 lg:mt-0">
          <h1 className="max-w-md text-[1.7rem] font-extrabold leading-tight lg:text-4xl">
            Sua jornada na capoeira, na palma da mão.
          </h1>
          <p className="mt-2 max-w-md text-sm text-primary-foreground/80 lg:text-base">
            Entre para acompanhar suas aulas, graduações e a vida do seu grupo.
          </p>
          <ul className="mt-8 hidden max-w-md flex-col gap-4 lg:flex">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-primary-foreground/90">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 mt-0 hidden text-xs text-primary-foreground/60 lg:block">© {new Date().getFullYear()} GingApp</p>
      </aside>

      {/* Formulário: no celular sobe sobre o banner como uma folha. */}
      <main className="relative -mt-8 flex flex-1 flex-col justify-center rounded-t-[28px] bg-background px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 lg:mt-0 lg:rounded-none lg:px-16 lg:py-12">
        <div className="mx-auto w-full max-w-sm">
          {challengeToken ? (
            <>
              <h2 className="text-2xl font-extrabold">Verificação em duas etapas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {useRecovery
                  ? "Digite um dos seus códigos de recuperação. Cada código vale uma única vez."
                  : "Digite o código de 6 dígitos do seu aplicativo autenticador."}
              </p>
              <form className="mt-7" onSubmit={submitTwoFactor} noValidate>
                {useRecovery ? (
                  <>
                    <label className="login-label" htmlFor="recoveryCode">
                      Código de recuperação
                    </label>
                    <div className="login-field">
                      <KeyRound className="login-icon" aria-hidden />
                      <input
                        id="recoveryCode"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="xxxxx-xxxxx"
                        value={recoveryCode}
                        onChange={(e) => setRecoveryCode(e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <label className="login-label" htmlFor="totpCode">
                      Código de 6 dígitos
                    </label>
                    <div className="login-field">
                      <ShieldCheck className="login-icon" aria-hidden />
                      <input
                        id="totpCode"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        maxLength={TOTP_CODE_LENGTH}
                        value={code}
                        onChange={(e) => setCode(cleanTotpCode(e.target.value))}
                      />
                    </div>
                  </>
                )}

                {error && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{error}</span>
                  </p>
                )}

                <Button className="mt-6 h-12 w-full text-base" type="submit" disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  {loading ? "Verificando…" : "Verificar"}
                </Button>
                <button
                  type="button"
                  className="mt-4 w-full py-1 text-sm text-muted-foreground underline"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setError("");
                  }}
                >
                  {useRecovery ? "Usar código do aplicativo" : "Usar código de recuperação"}
                </button>
                <Button className="mt-2 w-full" type="button" variant="outline" disabled={loading} onClick={() => backToCredentials()}>
                  Voltar
                </Button>
              </form>
            </>
          ) : (
            <>
          <h2 className="text-2xl font-extrabold">Bem-vindo de volta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Entre com seu e-mail e senha.</p>

          <form className="mt-7" onSubmit={submit} noValidate>
            <label className="login-label" htmlFor="email">
              E-mail
            </label>
            <div className="login-field">
              <Mail className="login-icon" aria-hidden />
              <input
                id="email"
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

            <label className="login-label" htmlFor="password">
              Senha
            </label>
            <div className="login-field">
              <Lock className="login-icon" aria-hidden />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>

            {(needsSlug || slug) && (
              <>
                <label className="login-label" htmlFor="slug">
                  Código do grupo
                </label>
                <div className="login-field">
                  <Users className="login-icon" aria-hidden />
                  <input
                    id="slug"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="ex.: grupo-semente"
                  />
                </div>
              </>
            )}

            {error && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </p>
            )}

            <Button className="mt-6 h-12 w-full text-base" type="submit" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
              {loading ? "Entrando…" : "Entrar"}
            </Button>

            {!needsSlug && !slug && (
              <button type="button" className="mt-4 w-full py-1 text-sm text-muted-foreground underline" onClick={() => setNeedsSlug(true)}>
                Pertenço a mais de um grupo
              </button>
            )}
          </form>
            </>
          )}

          {!challengeToken &&
            (resetByEmail ? (
              <p className="mt-8 text-center text-sm">
                <Link to="/esqueci-senha" className="underline" data-testid="forgot-link">
                  Esqueci minha senha
                </Link>
              </p>
            ) : (
              <p className="mt-8 text-center text-xs text-muted-foreground">
                Esqueceu a senha? Peça ao mestre ou à coordenação do seu grupo para redefinir.
              </p>
            ))}
          <LegalLinks />
        </div>
      </main>
    </div>
  );
}
