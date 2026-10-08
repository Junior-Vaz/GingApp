import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/auth";
import { Brand } from "./app-shell";

export function LoginPage({ redirect }: { redirect?: string | undefined }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [slug, setSlug] = useState("");
  const [needsSlug, setNeedsSlug] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    setLoading(true);
    try {
      await login({ email, password, organizationSlug: slug });
      // `redirect` só aceita caminhos internos (evita open redirect).
      const target = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
      await navigate({ to: target });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível entrar.";
      if (/organizationSlug|múltiplas organiza/i.test(message)) setNeedsSlug(true);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Brand />
          <p className="text-sm text-muted-foreground">Entre para acompanhar sua jornada na capoeira</p>
        </div>
        <form className="rounded-lg border border-border bg-card p-6" onSubmit={submit} noValidate>
          <label className="field-label" htmlFor="email">
            E-mail
          </label>
          <input className="profile-input" id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="field-label" htmlFor="password">
            Senha
          </label>
          <input className="profile-input" id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {(needsSlug || slug) && (
            <>
              <label className="field-label" htmlFor="slug">
                Código do grupo
              </label>
              <input className="profile-input" id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ex.: grupo-semente" />
            </>
          )}
          {error && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button className="mt-6 w-full" type="submit" disabled={loading}>
            <LogIn />
            {loading ? "Entrando…" : "Entrar"}
          </Button>
          {!needsSlug && !slug && (
            <button type="button" className="mt-4 w-full text-xs text-muted-foreground underline" onClick={() => setNeedsSlug(true)}>
              Pertenço a mais de um grupo
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
