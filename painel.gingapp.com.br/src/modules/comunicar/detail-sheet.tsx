import { useState } from "react";
import { BellRing, Pin, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError } from "@/lib/api";
import { plural } from "@/lib/plural";
import { imageSrc } from "@/lib/uploads";
import { useCancelCommunication, useCommunication, useResendUnread } from "./api";
import { ROLE_LABEL, SCOPE_LABEL, STATUS_LABEL, type CommunicationDetail } from "./types";
import { STATUS_VARIANT, commErrorMessage, resendMessage, whenOf } from "./utils";

/** Alcance em palavras: "Todo o grupo", "Turma Infantil", "Papel: Alunos"… */
function scopeText(detail: CommunicationDetail): string {
  const type = detail.scope?.type ?? detail.scopeType;
  const label = SCOPE_LABEL[type] ?? type;
  switch (type) {
    // Os nomes vêm de `scope.unitName`/`className` (o servidor manda `null` quando a unidade/turma foi apagada).
    case "UNIT":
      return detail.scope?.unitName ? `Unidade ${detail.scope.unitName}` : label;
    case "CLASS":
      return detail.scope?.className ? `Turma ${detail.scope.className}` : label;
    case "ROLE":
      return detail.scope?.role ? `Papel: ${ROLE_LABEL[detail.scope.role] ?? detail.scope.role}` : label;
    default:
      return label;
  }
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5 text-center" data-testid={testId}>
      <p className="text-xl font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/** Detalhe de uma mensagem do histórico (painel lateral; folha de baixo no celular): números, confirmações e ações. */
export function CommunicationSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" : "w-full overflow-y-auto sm:max-w-lg"}
        data-testid="communication-sheet"
      >
        <SheetHeader>
          <SheetTitle>Detalhe da mensagem</SheetTitle>
          <SheetDescription>Quem recebeu, quem leu e quem já respondeu.</SheetDescription>
        </SheetHeader>
        {id !== null && <DetailBody id={id} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ id }: { id: number }) {
  const query = useCommunication(id);
  const resend = useResendUnread();
  const cancel = useCancelCommunication();
  const [resending, setResending] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (query.isLoading) return <Skeleton className="mt-4 h-48 w-full" />;
  if (query.error || !query.data) {
    return (
      <div role="alert" className="mt-4 space-y-2 text-sm text-destructive">
        <p>{commErrorMessage(query.error, "Não foi possível carregar a mensagem.")}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const c = query.data;
  const acks = c.acks ?? { READ: 0, GOING: 0, NOT_GOING: 0 };
  const unread = Math.max(0, c.recipientsCount - c.readCount);
  const canResend = c.status === "SENT" && unread > 0;
  const canCancel = c.status === "SCHEDULED";
  const img = c.imageUrl ? imageSrc(c.imageUrl) : "";

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
          {c.pinToFeed && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Pin className="size-3" aria-hidden /> Fixada no feed
            </span>
          )}
        </div>
        <h3 className="break-words text-lg font-bold leading-tight">{c.title}</h3>
        <p className="text-xs text-muted-foreground">
          {scopeText(c)} · {c.status === "SCHEDULED" ? "Agendada para" : "Enviada em"} {whenOf(c)} · por {c.createdByName ?? "autor removido"}
        </p>
      </div>

      {img && <img src={img} alt="Imagem da mensagem" className="max-h-56 w-full rounded-lg border object-cover" />}
      <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>

      <section aria-label="Resultado" className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Resultado</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Destinatários" value={c.recipientsCount} testId="stat-recipients" />
          <Stat label="Lidos" value={c.readCount} testId="stat-read" />
          <Stat label="Pendentes" value={c.pending} testId="stat-pending" />
          <Stat label="Responderam" value={c.ackCount} testId="stat-acks" />
        </div>
        {c.requiresAck !== "NONE" && (
          <ul className="grid grid-cols-3 gap-2" aria-label="Respostas">
            <li>
              <Stat label="Li" value={acks.READ} testId="ack-read" />
            </li>
            <li>
              <Stat label="Vou" value={acks.GOING} testId="ack-going" />
            </li>
            <li>
              <Stat label="Não vou" value={acks.NOT_GOING} testId="ack-not-going" />
            </li>
          </ul>
        )}
      </section>

      {(canResend || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canResend && (
            <Button type="button" variant="secondary" onClick={() => setResending(true)}>
              <BellRing /> Reenviar para quem não leu
            </Button>
          )}
          {canCancel && (
            <Button type="button" variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>
              <XCircle /> Cancelar envio
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={resending}
        onOpenChange={setResending}
        variant="default"
        title="Reenviar para quem não leu?"
        description={`A mensagem é enviada de novo só para ${plural(unread, "pessoa")} que ainda não leu. Só dá para reenviar uma vez a cada 24 horas.`}
        confirmLabel="Reenviar"
        onConfirm={async () => {
          try {
            const result = await resend.mutateAsync(c.id);
            // Formato real: 201 { sent }; `sent: 0` não é sucesso de verdade (ninguém sem ler).
            if (typeof result?.sent === "number" && result.sent <= 0) toast.info(resendMessage(result));
            else toast.success(resendMessage(result));
          } catch (error) {
            toast.error(commErrorMessage(error, "Não foi possível reenviar a mensagem."));
            // Reenvio recente não adianta tentar de novo agora: fecha o diálogo.
            if (!(error instanceof ApiError && error.code === "RESEND_TOO_SOON")) throw error;
          }
        }}
      />

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancelar este envio?"
        description="A mensagem agendada não será enviada. Isso não pode ser desfeito."
        confirmLabel="Cancelar envio"
        cancelLabel="Voltar"
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(c.id);
            toast.success("Envio cancelado.");
          } catch (error) {
            toast.error(commErrorMessage(error, "Não foi possível cancelar o envio."));
            // Já enviada: não há o que tentar de novo (a tela atualiza e mostra "Enviado").
            if (!(error instanceof ApiError && error.code === "ALREADY_SENT")) throw error;
          }
        }}
      />
    </div>
  );
}
