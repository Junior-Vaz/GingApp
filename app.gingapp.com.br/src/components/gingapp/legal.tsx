import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import {
  acceptTerms,
  exportMyData,
  fetchLegalDocument,
  fetchLegalVersion,
  refreshTermsStatus,
  requestDataDeletion,
  type LegalDocumentType,
} from "@/lib/legal";
import { useSessionUser } from "@/lib/session";
import { Brand } from "./app-shell";

/** Página pública /termos e /privacidade: o texto vem da API (mesma fonte dos 3 frontends). */
export function LegalPage({ type }: { type: LegalDocumentType }) {
  const query = useQuery({ queryKey: ["legal", type], queryFn: () => fetchLegalDocument(type), retry: 1 });
  const doc = query.data;
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10">
      <Link to="/login" search={{ redirect: undefined }} className="no-underline">
        <Brand />
      </Link>
      <article className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 text-sm leading-relaxed">
        {query.isLoading && <p className="text-muted-foreground">Carregando…</p>}
        {query.isError && (
          <p role="alert" className="text-destructive">
            Não foi possível carregar este documento. Tente novamente mais tarde.
          </p>
        )}
        {doc && (
          <>
            <p
              role="note"
              className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-semibold"
              data-testid="legal-notice"
            >
              {doc.notice}
            </p>
            <h1 className="text-2xl font-extrabold">{doc.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Versão {doc.version} · atualizado em {doc.updatedAt.split("-").reverse().join("/")}
            </p>
            {doc.sections.map((section) => (
              <section key={section.heading} className="mt-5">
                <h2 className="text-base font-bold">{section.heading}</h2>
                {section.paragraphs.map((paragraph, index) => (
                  <p key={index} className="mt-2 text-muted-foreground">
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </>
        )}
        <nav className="mt-8 flex flex-wrap gap-4 border-t border-border pt-4 text-xs">
          <Link to="/termos" className="underline">
            Termos de Uso
          </Link>
          <Link to="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          <Link to="/login" search={{ redirect: undefined }} className="underline">
            Voltar ao login
          </Link>
        </nav>
      </article>
    </div>
  );
}

/** Links do rodapé da tela de login. */
export function LegalLinks() {
  return (
    <p className="mt-3 text-center text-xs text-muted-foreground" data-testid="legal-links">
      <Link to="/termos" className="underline">
        Termos de Uso
      </Link>
      {" · "}
      <Link to="/privacidade" className="underline">
        Política de Privacidade
      </Link>
    </p>
  );
}

/**
 * Tela BLOQUEANTE de aceite dos Termos + Política (E10): aparece sobre o app enquanto houver aceite pendente
 * (e a troca de senha provisória, que vem antes, já estiver feita). O servidor só barra o uso se
 * TERMS_ENFORCEMENT=true; por padrão quem exige é esta tela.
 */
export function TermsGate() {
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const unknown = !!user && !user.mustChangePassword && user.termsAcceptanceRequired === undefined;
  const required = !!user && !user.mustChangePassword && user.termsAcceptanceRequired === true;

  // Sessão guardada antes dos termos existirem (ou de uma versão antiga): pergunta ao servidor uma vez.
  useEffect(() => {
    if (unknown) void refreshTermsStatus();
  }, [unknown]);

  const version = useQuery({ queryKey: ["legal-version"], queryFn: fetchLegalVersion, enabled: required, retry: 1 });
  const accept = useMutation({
    mutationFn: () => acceptTerms(version.data ?? user?.currentTermsVersion ?? ""),
    onError: (error) => toast.error(errorMessage(error, "Não foi possível registrar o aceite.")),
  });

  if (!required) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      data-testid="terms-gate"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck size={22} />
        </span>
        <h2 id="terms-gate-title" className="mt-3 text-lg font-extrabold">
          Termos de Uso e Política de Privacidade
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Para continuar, leia e aceite os documentos abaixo. Eles explicam como seus dados (e, no caso de menores, os
          dados do aluno) são tratados, conforme a LGPD.
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm">
          <li>
            <a href="/termos" target="_blank" rel="noopener noreferrer" className="underline">
              Termos de Uso
            </a>
          </li>
          <li>
            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline">
              Política de Privacidade
            </a>
          </li>
        </ul>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>Li e concordo com os Termos de Uso e com a Política de Privacidade.</span>
        </label>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={!agreed || accept.isPending || version.isLoading} onClick={() => accept.mutate()}>
            {accept.isPending && <Loader2 className="animate-spin" />}
            Aceitar e continuar
          </Button>
          <Button variant="outline" onClick={() => logout(queryClient)}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}

/** "Meus dados" (perfil): exportar os próprios dados e pedir exclusão/anonimização (LGPD art. 18). */
export function MyDataSection() {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [requested, setRequested] = useState(false);
  const me = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api.get<{ pendingDeletionRequest: { id: number } | null }>("/auth/me"),
  });
  const exporting = useMutation({
    mutationFn: exportMyData,
    onError: (error) => toast.error(errorMessage(error, "Não foi possível exportar seus dados.")),
  });
  const deletion = useMutation({
    mutationFn: () => requestDataDeletion(reason),
    onSuccess: () => {
      setRequested(true);
      setConfirming(false);
      toast.success("Pedido registrado. Você será informado sobre o resultado.");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível registrar o pedido.")),
  });
  const pending = requested || !!me.data?.pendingDeletionRequest;

  return (
    <section className="content-band mt-6" aria-labelledby="my-data-title" data-testid="my-data">
      <h2 id="my-data-title">Meus dados (LGPD)</h2>
      <p className="text-xs text-muted-foreground">
        Você pode baixar uma cópia dos seus dados ou pedir a exclusão/anonimização. O pedido é analisado pela equipe;
        registros que o grupo ou a lei exigem manter podem ser preservados ou apenas anonimizados.{" "}
        <Link to="/privacidade" className="underline">
          Política de Privacidade
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
          <Download />
          Baixar meus dados
        </Button>
        {pending ? (
          <p className="self-center text-xs font-semibold" role="status">
            Pedido de exclusão registrado e em análise.
          </p>
        ) : (
          !confirming && (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <Trash2 />
              Pedir exclusão dos meus dados
            </Button>
          )
        )}
      </div>
      {confirming && !pending && (
        <div className="mt-3">
          <label className="field-label" htmlFor="deletion-reason">
            Motivo (opcional)
          </label>
          <textarea
            id="deletion-reason"
            className="profile-input"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button disabled={deletion.isPending} onClick={() => deletion.mutate()}>
              Confirmar pedido
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
