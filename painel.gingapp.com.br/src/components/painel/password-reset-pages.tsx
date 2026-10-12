import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Mail } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { PasswordInput } from "@/components/painel/password-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  FORGOT_PASSWORD_NEUTRAL_MESSAGE,
  RESET_LINK_MISSING_MESSAGE,
  RESET_PASSWORD_SUCCESS,
  forgotPasswordErrorMessage,
  forgotPasswordSchema,
  requestPasswordReset,
  resetByTokenSchema,
  resetPasswordErrorMessage,
  resetPasswordWithToken,
  type ForgotPasswordValues,
  type ResetByTokenValues,
} from "@/lib/password-reset";

function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Brand large />
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Card className="p-6">{children}</Card>
      </div>
    </div>
  );
}

const BackToLogin = () => (
  <Link to="/login" search={{ redirect: undefined }} className="text-sm underline">
    Voltar ao login
  </Link>
);

/** /esqueci-senha (pública): pede o link de redefinição. O resultado é SEMPRE a mesma mensagem neutra. */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [needsSlug, setNeedsSlug] = useState(false);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "", organizationSlug: "" },
  });

  async function onSubmit(values: ForgotPasswordValues) {
    setError("");
    try {
      await requestPasswordReset(values);
      setSent(true);
    } catch (err) {
      setError(forgotPasswordErrorMessage(err));
    }
  }

  return (
    <AuthShell subtitle="Recuperar acesso ao painel">
      {sent ? (
        <div className="grid gap-4">
          <p role="status" className="text-sm" data-testid="forgot-neutral">
            {FORGOT_PASSWORD_NEUTRAL_MESSAGE}
          </p>
          <BackToLogin />
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha.
            </p>
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
              <Mail />
              {form.formState.isSubmitting ? "Enviando…" : "Enviar link"}
            </Button>
            {!needsSlug && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setNeedsSlug(true)}>
                Pertenço a mais de um grupo
              </button>
            )}
            <BackToLogin />
          </form>
        </Form>
      )}
    </AuthShell>
  );
}

/**
 * /redefinir-senha?token=... (pública): define a nova senha. O token é lido da URL, guardado só em memória
 * e REMOVIDO da URL (navegação com replace) para não ficar no histórico/referer.
 */
export function ResetPasswordPage({ token }: { token: string | undefined }) {
  const navigate = useNavigate();
  const [initialToken] = useState(token ?? "");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<ResetByTokenValues>({
    resolver: zodResolver(resetByTokenSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (token) void navigate({ to: "/redefinir-senha", search: { token: undefined }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem: o token já foi copiado para o estado
  }, []);

  async function onSubmit(values: ResetByTokenValues) {
    setError("");
    try {
      await resetPasswordWithToken(initialToken, values.newPassword);
      setDone(true);
    } catch (err) {
      setError(resetPasswordErrorMessage(err));
    }
  }

  let content: ReactNode;
  if (done) {
    content = (
      <div className="grid gap-4">
        <p role="status" className="text-sm" data-testid="reset-success">
          {RESET_PASSWORD_SUCCESS}
        </p>
        <Button asChild className="w-full">
          <Link to="/login" search={{ redirect: undefined }}>
            Ir para o login
          </Link>
        </Button>
      </div>
    );
  } else if (!initialToken) {
    content = (
      <div className="grid gap-4">
        <p role="alert" className="text-sm text-destructive" data-testid="reset-missing-token">
          {RESET_LINK_MISSING_MESSAGE}
        </p>
        <Link to="/esqueci-senha" className="text-sm underline">
          Solicitar novo link
        </Link>
        <BackToLogin />
      </div>
    );
  } else {
    content = (
      <Form {...form}>
        <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nova senha</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" toggleLabel="nova senha" {...field} />
                </FormControl>
                <p className="text-xs text-muted-foreground">No mínimo 12 caracteres (máx. 72 bytes).</p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmar nova senha</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" toggleLabel="confirmação da nova senha" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error && (
            <div className="grid gap-1">
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
              <Link to="/esqueci-senha" className="text-xs underline">
                Solicitar novo link
              </Link>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            <KeyRound />
            {form.formState.isSubmitting ? "Salvando…" : "Redefinir senha"}
          </Button>
        </form>
      </Form>
    );
  }

  return <AuthShell subtitle="Definir nova senha">{content}</AuthShell>;
}
