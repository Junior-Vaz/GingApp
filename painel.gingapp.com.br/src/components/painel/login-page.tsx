import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { LegalLinks } from "@/components/painel/legal";
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

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const navigate = useNavigate();
  // Desafio do 2FA: só em memória deste componente (recarregar a página volta ao primeiro passo).
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  // Link "Esqueci minha senha" só com e-mail ligado no servidor (consulta com erro = oculto).
  const { passwordResetByEmail } = useAuthCapabilities();
  const [needsSlug, setNeedsSlug] = useState(false);
  const [error, setError] = useState("");
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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Brand />
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
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" {...field} />
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
                    <FormLabel>Senha</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
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
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                <LogIn />
                {form.formState.isSubmitting ? "Entrando…" : "Entrar"}
              </Button>
              {passwordResetByEmail && (
                <Link to="/esqueci-senha" className="text-center text-sm underline">
                  Esqueci minha senha
                </Link>
              )}
              {!needsSlug && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setNeedsSlug(true)}
                >
                  Pertenço a mais de um grupo
                </button>
              )}
            </form>
          </Form>
          )}
        </Card>
        <LegalLinks />
      </div>
    </div>
  );
}
