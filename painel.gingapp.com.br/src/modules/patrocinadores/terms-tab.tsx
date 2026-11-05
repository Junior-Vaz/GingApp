import { useId, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { sponsorsErrorMessage, useAcceptTerms, type useTerms } from "./api";
import { formatInstant, type SponsorTerms } from "./sponsor-utils";

type TermsQuery = ReturnType<typeof useTerms>;

/** Aviso destacado quando a PLATAFORMA bloqueou o patrocínio local do grupo (com o motivo). */
export function BlockedAlert({ terms }: { terms: SponsorTerms | undefined }) {
  if (!terms?.blocked) return null;
  return (
    <Alert variant="destructive" data-testid="blocked-alert" className="mb-4 border-2">
      <ShieldAlert className="size-4" aria-hidden />
      <div>
        <AlertTitle>Patrocínio bloqueado pela plataforma</AlertTitle>
        <AlertDescription>
          <p>
            A plataforma bloqueou o uso de patrocinadores no seu grupo: suas campanhas não são exibidas e não é possível ativar novas.
          </p>
          <p className="mt-1">
            <strong>Motivo:</strong> {terms.blockedReason?.trim() || "não informado"}
          </p>
        </AlertDescription>
      </div>
    </Alert>
  );
}

/** Aviso (com atalho para a aba Termo) quando o termo da versão vigente ainda não foi aceito. */
export function TermsPendingAlert({ terms, onOpen }: { terms: SponsorTerms | undefined; onOpen: () => void }) {
  if (!terms || terms.accepted) return null;
  return (
    <Alert data-testid="terms-pending-alert" className="mb-4 border-amber-400 bg-amber-50 text-amber-950">
      <AlertTriangle className="size-4 text-amber-700" aria-hidden />
      <div>
        <AlertTitle>Termo de responsabilidade pendente</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          <span>Enquanto você não aceitar o termo, o painel fica só para leitura e não é possível ativar campanhas.</span>
          <Button type="button" size="sm" variant="outline" onClick={onOpen}>
            Ler e aceitar o termo
          </Button>
        </AlertDescription>
      </div>
    </Alert>
  );
}

/** Aba "Termo": texto completo, caixa "Li e aceito" e botão. A versão nova (ou diferente) pede novo aceite. */
export function TermsTab({ query }: { query: TermsQuery }) {
  const accept = useAcceptTerms();
  const [agreed, setAgreed] = useState(false);
  const checkId = useId();
  const terms = query.data;

  if (query.isLoading) {
    return (
      <div className="grid gap-3" data-testid="terms-loading">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (query.error || !terms) {
    return (
      <Card className="items-center gap-3 p-6 text-center" role="alert" data-testid="terms-error">
        <p className="text-sm text-destructive">{sponsorsErrorMessage(query.error, "Não foi possível carregar o termo de responsabilidade.")}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  function submit() {
    if (!terms) return;
    accept.mutate(terms.version, {
      onSuccess: () => {
        setAgreed(false);
        toast.success("Termo aceito. Agora você já pode ativar campanhas.");
      },
      onError: (error) => {
        // 409 TERMS_VERSION_MISMATCH: o hook já recarregou o termo; o usuário precisa ler a nova versão e marcar de novo.
        setAgreed(false);
        toast.error(sponsorsErrorMessage(error, errorMessage(error, "Não foi possível registrar o aceite.")));
      },
    });
  }

  return (
    <div className="grid gap-4" data-testid="terms-tab">
      <div>
        <h2 className="text-lg font-bold">Termo de responsabilidade do anunciante local</h2>
        <p className="text-sm text-muted-foreground">
          Versão <span data-testid="terms-version">{terms.version}</span>
          {terms.accepted && terms.acceptedAt ? ` · aceito em ${formatInstant(terms.acceptedAt)}` : ""}
        </p>
      </div>

      <div
        // Região rolável e focável pelo teclado, para quem lê com leitor de tela ou sem mouse.
        role="region"
        aria-label="Texto do termo de responsabilidade"
        tabIndex={0}
        data-testid="terms-text"
        className="max-h-[50vh] overflow-y-auto rounded-lg border bg-background p-4 text-sm leading-relaxed whitespace-pre-line focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {terms.text}
      </div>

      {terms.accepted ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800" data-testid="terms-accepted">
          <CheckCircle2 className="size-5" aria-hidden /> Você já aceitou esta versão do termo.
        </p>
      ) : (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <input
              id={checkId}
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-5 shrink-0 cursor-pointer accent-primary"
            />
            <label htmlFor={checkId} className="cursor-pointer text-sm leading-snug">
              Li e aceito o termo de responsabilidade (versão {terms.version}). Respondo pelo conteúdo e pelos links dos anúncios que ativar.
            </label>
          </div>
          <div>
            <Button type="button" disabled={!agreed || accept.isPending} onClick={submit}>
              {accept.isPending ? "Registrando…" : "Aceitar o termo"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
