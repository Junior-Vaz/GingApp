import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LogIn } from "lucide-react";
import { Brand } from "@/components/painel/brand";
import { LegalLinks } from "@/components/painel/legal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { login, safeRedirect } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().min(1, "Informe o e-mail.").email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha."),
  organizationSlug: z.string().optional(),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const navigate = useNavigate();
  const [needsSlug, setNeedsSlug] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", organizationSlug: "" },
  });

  async function onSubmit(values: LoginValues) {
    setError("");
    try {
      await login(
        values.organizationSlug
          ? { email: values.email, password: values.password, organizationSlug: values.organizationSlug }
          : { email: values.email, password: values.password },
      );
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
        </Card>
        <LegalLinks />
      </div>
    </div>
  );
}
