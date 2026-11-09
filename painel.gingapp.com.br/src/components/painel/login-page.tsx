import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Award, CalendarCheck, Loader2, LogIn, ShieldCheck, TriangleAlert, Users, Wallet } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { LegalLinks } from "@/components/painel/legal";
import { PasswordInput } from "@/components/painel/password-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isChallengeExpired, isTwoFactorChallenge, login, safeRedirect, verifyTwoFactor } from "@/lib/auth";
import { useAuthCapabilities } from "@/lib/password-reset";
import { RECOVERY_CODE_PATTERN, TWO_FACTOR_CODE_PATTERN, twoFactorErrorMessage } from "@/lib/two-factor";

const loginSchema = z.object({
  email: z.string().min(1, "Informe o e-mail.").email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha."),
  organizationSlug: z.string().optional(),
});
type LoginValues = z.infer<typeof loginSchema>;

/** Benefícios mostrados ao lado do cartão de login (só no desktop, >= 1024 px). */
const BENEFITS = [
  { icon: Users, text: "Alunos, turmas e aulas do grupo num só lugar" },
  { icon: CalendarCheck, text: "Chamada e frequência em poucos toques" },
  { icon: Award, text: "Graduações e certificados com QR de verificação" },
  { icon: Wallet, text: "Financeiro e comunicados para os alunos" },
] as const;

/** Entrada leve; some com `prefers-reduced-motion` (variante `motion-reduce` do Tailwind). */
const ENTER_ANIMATION = "animate-in fade-in-0 slide-in-from-bottom-2 duration-500 motion-reduce:animate-none";

/**
 * Segundo passo do login (2FA): código de 6 dígitos do app autenticador ou código de recuperação.
 * O `challengeToken` vive só na memória de LoginPage (nunca em storage/URL).
 */
function TwoFactorStep({
  challengeToken,
  onDone,
  onBack,
  onExpired,
}: {
  challengeToken: string;
  onDone: () => Promise<void>;
  onBack: () => void;
  onExpired: (message: string) => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function switchMode() {
    setUseRecovery((current) => !current);
    setValue("");
    setError("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const typed = value.trim();
    if (useRecovery ? !RECOVERY_CODE_PATTERN.test(typed) : !TWO_FACTOR_CODE_PATTERN.test(typed)) {
      setError(useRecovery ? "Informe o código de recuperação no formato xxxxx-xxxxx." : "Informe os 6 dígitos do código.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await verifyTwoFactor(challengeToken, useRecovery ? { recoveryCode: typed } : { code: typed });
      await onDone();
    } catch (err) {
      if (isChallengeExpired(err)) {
        onExpired(err instanceof Error ? err.message : "A verificação expirou. Entre novamente.");
        return;
      }
      setError(err instanceof Error ? twoFactorErrorMessage(err, "Não foi possível verificar o código.") : "Não foi possível verificar o código.");
      setSubmitting(false);
    }
  }

  const fieldId = useRecovery ? "recovery-code" : "two-factor-code";
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="grid gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" aria-hidden />
        <h1 className="text-base font-bold">Verificação em duas etapas</h1>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={fieldId}>{useRecovery ? "Código de recuperação" : "Código de 6 dígitos"}</Label>
        {useRecovery ? (
          <Input
            id={fieldId}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="xxxxx-xxxxx"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <Input
            id={fieldId}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {useRecovery
            ? "Use um dos códigos de recuperação que você guardou. Cada código vale uma única vez."
            : "Abra o app autenticador e digite o código atual da sua conta GingApp."}
        </p>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Verificando…" : "Verificar"}
      </Button>
      <button type="button" className="text-center text-sm underline" onClick={switchMode}>
        {useRecovery ? "Usar código do app autenticador" : "Usar código de recuperação"}
      </button>
      <Button type="button" variant="outline" className="w-full" onClick={onBack} disabled={submitting}>
        Voltar
      </Button>
    </form>
  );
}

const LOGIN_ERROR_ID = "login-error";

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const navigate = useNavigate();
  // Desafio do 2FA: só em memória deste componente (recarregar a página volta ao primeiro passo).
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  // Link "Esqueci minha senha" só com e-mail ligado no servidor (consulta com erro = oculto).
  const { passwordResetByEmail } = useAuthCapabilities();
  const [needsSlug, setNeedsSlug] = useState(false);
  const [error, setError] = useState("");
  // Caps Lock ligado enquanto o foco está na senha (só aviso: não muda nada na autenticação).
  const [capsLock, setCapsLock] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", organizationSlug: "" },
  });

  async function onSubmit(values: LoginValues) {
    setError("");
    try {
      const result = await login(
        values.organizationSlug
          ? { email: values.email, password: values.password, organizationSlug: values.organizationSlug }
          : { email: values.email, password: values.password },
      );
      if (isTwoFactorChallenge(result)) {
        setChallengeToken(result.challengeToken);
        return;
      }
      await navigate({ to: safeRedirect(redirect) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível entrar.";
      if (/organizationSlug|múltiplas organiza/i.test(message)) setNeedsSlug(true);
      setError(message);
    }
  }

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
  };
  const submitting = form.formState.isSubmitting;

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      {/* Desktop: lado esquerdo com a marca e os benefícios do painel. */}
      <aside className="hidden flex-col justify-between border-r px-12 py-12 lg:flex" data-testid="login-benefits">
        <Brand large />
        <div className={ENTER_ANIMATION}>
          <h2 className="max-w-md text-3xl font-extrabold leading-tight">Tudo do seu grupo de capoeira, num painel só.</h2>
          <ul className="mt-8 grid max-w-md gap-4">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-base">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">Feito para quem cuida de um grupo de capoeira.</p>
      </aside>

      <div className="flex min-h-screen flex-col items-center justify-center px-5 py-8 lg:min-h-0 lg:px-12">
        <div className={`w-full max-w-sm ${ENTER_ANIMATION}`}>
          {/* Celular/tablet: a marca fica no topo do cartão. */}
          <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
            <Brand large />
            <p className="text-sm text-muted-foreground">Painel de gestão do grupo</p>
          </div>
          <Card className="p-6">
            {challengeToken ? (
              <TwoFactorStep
                challengeToken={challengeToken}
                onDone={() => navigate({ to: safeRedirect(redirect) })}
                onBack={() => {
                  setChallengeToken(null);
                  setError("");
                  form.setValue("password", "");
                }}
                onExpired={(message) => {
                  setChallengeToken(null);
                  form.setValue("password", "");
                  setError(message);
                }}
              />
            ) : (
              <Form {...form}>
                <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="grid gap-4">
                  <h1 className="text-xl font-extrabold">Entrar no painel</h1>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-mail</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between gap-2">
                          <FormLabel>Senha</FormLabel>
                          {passwordResetByEmail && (
                            <Link
                              to="/esqueci-senha"
                              className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline"
                            >
                              Esqueci minha senha
                            </Link>
                          )}
                        </div>
                        <FormControl>
                          <PasswordInput
                            autoComplete="current-password"
                            toggleLabel="senha"
                            {...field}
                            onKeyDown={trackCapsLock}
                            onKeyUp={trackCapsLock}
                            onBlur={() => {
                              setCapsLock(false);
                              field.onBlur();
                            }}
                            {...(error ? { "aria-describedby": LOGIN_ERROR_ID, "aria-invalid": true } : {})}
                          />
                        </FormControl>
                        {capsLock && (
                          <p className="flex items-center gap-1.5 text-xs font-medium" role="status" data-testid="caps-lock-warning">
                            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
                            Caps Lock está ligado. A senha diferencia maiúsculas de minúsculas.
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {needsSlug && (
                    <FormField
                      control={form.control}
                      name="organizationSlug"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Código do grupo</FormLabel>
                          <FormControl>
                            <Input placeholder="ex.: ginga-brasil" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  {error && (
                    <p id={LOGIN_ERROR_ID} className="text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  <Button type="submit" size="lg" className="w-full" disabled={submitting} aria-busy={submitting}>
                    {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn />}
                    {submitting ? "Entrando…" : "Entrar"}
                  </Button>
                  {!needsSlug && (
                    <button
                      type="button"
                      className="min-h-11 text-xs text-muted-foreground underline"
                      onClick={() => setNeedsSlug(true)}
                    >
                      Pertenço a mais de um grupo
                    </button>
                  )}
                </form>
              </Form>
            )}
          </Card>
          {!challengeToken && (
            <div className="mt-5 rounded-xl border p-4 text-center" data-testid="signup-block">
              <p className="text-sm font-bold">Ainda não usa o GingApp?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Leve o seu grupo para o painel. É gratuito.</p>
              <Button asChild variant="outline" size="lg" className="mt-3 w-full">
                <Link to="/comecar">Cadastrar meu grupo</Link>
              </Button>
            </div>
          )}
          <LegalLinks />
        </div>
      </div>
    </div>
  );
}
