import { useEffect, useRef, type ReactNode } from "react";
import { CircleCheck, Copy, MessageCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { credentialsMessage, whatsappLink } from "@/lib/credentials";

async function copy(text: string, success: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(success);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

export interface CredentialsCardProps {
  /** Título do cartão, ex.: "Aluno cadastrado" ou "Nova senha gerada". */
  title: string;
  /** Nome da pessoa (aluno). */
  name: string;
  /** Login (e-mail). */
  email: string;
  /** Senha provisória em texto: só existe na resposta do servidor; nunca é guardada além deste cartão. */
  password: string;
  /** Telefone do aluno, para abrir o WhatsApp direto no contato. */
  phone?: string | null | undefined;
  /** Botões de ação do rodapé do cartão (ex.: "Concluir", "Cadastrar outro"). */
  children?: ReactNode;
}

/**
 * Cartão de credenciais: login + senha provisória grande (para ditar/copiar) e atalhos para copiar e enviar por
 * WhatsApp. Recebe o foco ao aparecer. A senha NÃO é escondida: o objetivo é ditar/copiar. Compartilhado pelo
 * cadastro rápido e pelo diálogo "Acesso do aluno".
 */
export function CredentialsCard({ title, name, email, password, phone, children }: CredentialsCardProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const message = credentialsMessage(email, password);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label="Credenciais de acesso"
      data-testid="credentials-card"
      className="grid gap-4 rounded-lg border bg-card p-4 outline-none"
    >
      <div role="status" className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 size-6 shrink-0 text-green-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-base font-semibold">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{name}</p>
        </div>
      </div>

      <dl className="grid gap-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Login</dt>
          <dd data-testid="credentials-email" className="break-all text-base font-medium">
            {email}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Senha provisória</dt>
          <dd
            data-testid="credentials-password"
            className="select-all break-all rounded-md bg-muted px-3 py-2 font-mono text-2xl font-bold tracking-wider"
          >
            {password}
          </dd>
        </div>
      </dl>

      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Anote agora: a senha não será mostrada de novo. O aluno troca no primeiro acesso.</span>
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => void copy(password, "Senha copiada.")}>
          <Copy /> Copiar senha
        </Button>
        <Button type="button" variant="outline" onClick={() => void copy(message, "Login e senha copiados.")}>
          <Copy /> Copiar login e senha
        </Button>
        <Button asChild variant="secondary" className="sm:col-span-2">
          <a href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Enviar por WhatsApp
          </a>
        </Button>
      </div>

      {children && <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">{children}</div>}
    </section>
  );
}
