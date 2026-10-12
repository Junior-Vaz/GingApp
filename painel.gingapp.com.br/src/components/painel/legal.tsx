import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Loader2, ShieldCheck, Trash2, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Brand } from "@/components/painel/brand";
import { ChangePasswordDialog } from "@/components/painel/change-password-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api";
import { logout } from "@/lib/auth";
import {
  acceptTerms,
  exportMyData,
  fetchLegalDocument,
  fetchLegalVersion,
  requestDataDeletion,
  type LegalDocumentType,
} from "@/lib/legal";
import { useSessionUser } from "@/lib/session";

/** Página pública /termos e /privacidade: o texto vem da API (mesma fonte dos 3 frontends). */
export function LegalPage({ type }: { type: LegalDocumentType }) {
  const query = useQuery({ queryKey: ["legal", type], queryFn: () => fetchLegalDocument(type), retry: 1 });
  const doc = query.data;
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10">
      <Brand large />
      <Card className="w-full max-w-2xl p-6 text-sm leading-relaxed">
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
        <nav className="mt-8 flex flex-wrap gap-4 border-t pt-4 text-xs">
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
      </Card>
    </div>
  );
}

/** Links do rodapé da tela de login. */
export function LegalLinks() {
  return (
    <p className="mt-4 text-center text-xs text-muted-foreground" data-testid="legal-links">
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
 * Troca de senha OBRIGATÓRIA (mustChangePassword): enquanto a flag estiver ligada o servidor devolve 403
 * (MUST_CHANGE_PASSWORD) em todas as rotas, então o painel só mostra esta tela com o diálogo de troca de senha
 * existente, que não pode ser dispensado. Ao trocar, `replaceToken` limpa a flag e o painel abre normalmente.
 */
export function MustChangePasswordScreen() {
  const [open, setOpen] = useState(true);
  const queryClient = useQueryClient();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6" data-testid="must-change-password">
      <Brand large />
      <Card className="w-full max-w-sm p-6 text-center">
        <KeyRound className="mx-auto size-8 text-primary" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">Crie uma nova senha</h1>
        <p className="mt-2 text-sm text-muted-foreground" role="alert">
          Sua senha foi definida por outra pessoa. Por segurança, crie uma senha nova para continuar usando o painel.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => setOpen(true)}>Alterar senha</Button>
          <Button variant="outline" onClick={() => logout(queryClient)}>
            Sair
          </Button>
        </div>
      </Card>
      {/* Fechado o diálogo, o botão "Alterar senha" acima reabre: a troca é obrigatória (o painel só abre depois dela). */}
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Tela BLOQUEANTE de aceite dos Termos + Política (E10): aparece sobre o painel enquanto houver aceite pendente.
 * O servidor só barra o uso se TERMS_ENFORCEMENT=true; por padrão quem exige é esta tela.
 */
export function TermsGate() {
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const required = !!user && !user.mustChangePassword && user.termsAcceptanceRequired === true;
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
      <Card className="w-full max-w-md p-6 shadow-lg">
        <ShieldCheck className="size-7 text-primary" aria-hidden />
        <h2 id="terms-gate-title" className="mt-3 text-lg font-extrabold">
          Termos de Uso e Política de Privacidade
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Para continuar, leia e aceite os documentos abaixo. Eles explicam como os dados do grupo, dos alunos (inclusive
          menores) e da sua conta são tratados, conforme a LGPD.
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
          <input type="checkbox" className="mt-0.5 size-4" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
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
      </Card>
    </div>
  );
}

/** Botão do topo "Meus dados": exportar os próprios dados e pedir exclusão/anonimização (LGPD art. 18). */
export function MyDataButton(): ReactNode {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [requested, setRequested] = useState(false);
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
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Meus dados">
        <UserRoundCog />
        <span className="hidden lg:inline">Meus dados</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Meus dados (LGPD)</DialogTitle>
            <DialogDescription>
              Baixe uma cópia dos seus dados ou peça a exclusão/anonimização. O pedido é analisado pela equipe; registros que
              a lei exige manter podem ser preservados ou apenas anonimizados.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
              <Download />
              Baixar meus dados
            </Button>
            {requested ? (
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
          {confirming && !requested && (
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="deletion-reason">
                Motivo (opcional)
              </label>
              <textarea
                id="deletion-reason"
                className="rounded-md border bg-background p-2 text-sm"
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="flex gap-2">
                <Button disabled={deletion.isPending} onClick={() => deletion.mutate()}>
                  Confirmar pedido
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            <Link to="/privacidade" className="underline">
              Política de Privacidade
            </Link>
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
