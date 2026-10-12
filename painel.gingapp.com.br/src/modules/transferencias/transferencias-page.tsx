import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import { GroupLogo } from "@/modules/alunos/aluno-conflito-dialog";
import { ContestarTransferenciaDialog } from "./contestar-transferencia-dialog";
import {
  CONTEST_REASON_LABEL,
  TRANSFER_STATUS_LABEL,
  transferErrorMessage,
  useCancelTransfer,
  useTransfers,
  type TransferStatus,
  type TransferView,
} from "./transfer-api";

const dateTime = (iso: string) => fmt(toDate(iso), "dd/MM/yyyy HH:mm");

const STATUS_VARIANT: Record<TransferStatus, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING_PERSON: "secondary",
  APPROVED: "default",
  COMPLETED: "default",
  DECLINED: "destructive",
  CANCELLED: "outline",
  EXPIRED: "outline",
};

function TransferCard({
  transfer,
  onCancel,
  onContest,
}: {
  transfer: TransferView;
  onCancel: (t: TransferView) => void;
  onContest: (t: TransferView) => void;
}) {
  const { person } = transfer;
  return (
    <Card className="gap-3 p-4" data-testid="transfer-card">
      <div className="flex flex-wrap items-start gap-3">
        <StudentAvatar name={person.name} photo={person.photo} className="size-12 text-base" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {person.name}
            {person.nickname && <span className="ml-1.5 font-normal text-muted-foreground">({person.nickname})</span>}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{person.gingappCode}</p>
        </div>
        <Badge variant={STATUS_VARIANT[transfer.status]}>{TRANSFER_STATUS_LABEL[transfer.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Grupos da transferência">
        <GroupLogo name={transfer.fromOrganization.name} logoUrl={transfer.fromOrganization.logoUrl} />
        <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
        <GroupLogo name={transfer.toOrganization.name} logoUrl={transfer.toOrganization.logoUrl} />
        {transfer.toUnit && <span className="text-xs text-muted-foreground">Unidade: {transfer.toUnit.name}</span>}
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Pedido em</dt>
          <dd>{dateTime(transfer.requestedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expira em</dt>
          <dd>{dateTime(transfer.expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Contestação até</dt>
          <dd>{dateTime(transfer.contestUntil)}</dd>
        </div>
        {transfer.decidedAt && (
          <div>
            <dt className="text-xs text-muted-foreground">Decidida em</dt>
            <dd>{dateTime(transfer.decidedAt)}</dd>
          </div>
        )}
      </dl>

      {transfer.note && (
        <p className="text-sm">
          <span className="text-muted-foreground">Observação: </span>
          {transfer.note}
        </p>
      )}

      {transfer.contests.length > 0 && (
        <div className="grid gap-1.5" aria-label="Contestações">
          <p className="text-xs font-semibold text-muted-foreground">Contestações (informativas)</p>
          <ul className="grid gap-1.5">
            {transfer.contests.map((c) => (
              <li key={c.id} className="rounded-md border p-2 text-sm">
                <span className="font-medium">{CONTEST_REASON_LABEL[c.reason]}</span>
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {c.organization.name} · {dateTime(c.createdAt)}
                </span>
                {c.note && <p className="mt-0.5 text-muted-foreground">{c.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(transfer.canCancel || transfer.canContest) && (
        <div className="flex flex-wrap justify-end gap-2">
          {transfer.canContest && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Contestar transferência de ${person.name}`}
              onClick={() => onContest(transfer)}
            >
              Contestar
            </Button>
          )}
          {transfer.canCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Cancelar pedido de ${person.name}`}
              onClick={() => onCancel(transfer)}
            >
              Cancelar pedido
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function TransferList({ direction }: { direction: "sent" | "received" }) {
  const list = useTransfers(direction);
  const cancel = useCancelTransfer();
  const [canceling, setCanceling] = useState<TransferView | null>(null);
  const [contesting, setContesting] = useState<TransferView | null>(null);

  if (list.isLoading) {
    return (
      <div className="grid gap-3" data-testid="transfers-loading">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    );
  }
  if (list.error) {
    return (
      <Card className="items-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-destructive">
          {errorMessage(list.error, "Não foi possível carregar as transferências.")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }
  const items = list.data ?? [];

  return (
    <>
      {items.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {direction === "sent" ? "Nenhum pedido de transferência enviado." : "Nenhuma transferência recebida."}
        </p>
      ) : (
        <div className="grid gap-3">
          {items.map((t) => (
            <TransferCard key={t.id} transfer={t} onCancel={setCanceling} onContest={setContesting} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={canceling !== null}
        onOpenChange={(o) => !o && setCanceling(null)}
        title="Cancelar pedido de transferência?"
        description={
          canceling
            ? `O pedido de ${canceling.person.name} deixa de aguardar a aprovação da pessoa. Você poderá enviar outro depois.`
            : undefined
        }
        confirmLabel="Cancelar pedido"
        cancelLabel="Voltar"
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(canceling!.id);
            toast.success("Pedido de transferência cancelado.");
          } catch (error) {
            toast.error(transferErrorMessage(error, "Não foi possível cancelar o pedido."));
            throw error;
          }
        }}
      />
      <ContestarTransferenciaDialog transfer={contesting} onClose={() => setContesting(null)} />
    </>
  );
}

/**
 * "Transferências" (só o MESTRE): pedidos que o seu grupo enviou para trazer alguém de outro grupo (Enviadas) e os que
 * chegaram sobre alunos seus (Recebidas). Cancelar vale para o grupo que pediu; Contestar, para o grupo antigo, enquanto
 * o prazo estiver aberto (a contestação é informativa e não bloqueia a transferência).
 */
export function TransferenciasPage() {
  return (
    <>
      <PageHeader
        title="Transferências"
        description="Pedidos de transferência de capoeiristas entre grupos. A pessoa (ou o responsável) decide pelo app."
      />
      <Tabs defaultValue="sent">
        <TabsList aria-label="Direção das transferências">
          <TabsTrigger value="sent">Enviadas</TabsTrigger>
          <TabsTrigger value="received">Recebidas</TabsTrigger>
        </TabsList>
        <TabsContent value="sent">
          <TransferList direction="sent" />
        </TabsContent>
        <TabsContent value="received">
          <TransferList direction="received" />
        </TabsContent>
      </Tabs>
    </>
  );
}
