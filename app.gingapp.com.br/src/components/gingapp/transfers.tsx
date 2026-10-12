import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronRight, Info, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import {
  pendingTransfersOf,
  useTransfers,
  usePendingTransferCount,
  type PersonTransferView,
  type TransferContestReason,
  type TransferShared,
  type TransferStatus,
} from "@/lib/queries";
import { Avatar } from "./avatar";
import { PageHeading, StateMessage } from "./shared";

const STATUS_LABEL: Record<TransferStatus, string> = {
  PENDING_PERSON: "Aguardando decisão",
  APPROVED: "Aprovada",
  DECLINED: "Recusada",
  CANCELLED: "Cancelada pelo grupo novo",
  EXPIRED: "Expirada",
  COMPLETED: "Concluída",
};

const CONTEST_LABEL: Record<TransferContestReason, string> = {
  PENDING_PAYMENT: "Pendência financeira",
  EQUIPMENT: "Material ou equipamento pendente",
  OTHER: "Outro motivo",
};

const SHARED_LABEL: Record<TransferShared, string> = {
  ATTENDANCE: "frequência por turma",
  GRADUATIONS: "graduações",
  CERTIFICATES: "certificados",
};

const day = (iso: string) => fmt(toDate(iso), "dd/MM/yyyy");

/** Mensagem clara para os erros de negócio da decisão (404 e 409 TRANSFER_*). */
function decisionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "TRANSFER_EXPIRED") return "Este pedido expirou e não pode mais ser decidido.";
    if (error.code === "TRANSFER_NOT_PENDING") return "Este pedido já foi decidido ou cancelado. A lista foi atualizada.";
    if (error.status === 404) return "Pedido não encontrado ou você não tem permissão para decidir por ele.";
  }
  return errorMessage(error, "Não foi possível registrar sua decisão. Tente novamente.");
}

function sharedList(transfer: PersonTransferView): string {
  const items = transfer.sharedOnApproval.map((item) => SHARED_LABEL[item]).filter(Boolean);
  return items.length > 0 ? items.join(", ") : "frequência por turma, graduações e certificados";
}

/** Quem decide, em linguagem simples: aparece em todo pedido pendente. */
function DecidingNote({ transfer }: { transfer: PersonTransferView }) {
  if (transfer.status !== "PENDING_PERSON") return null;
  if (transfer.canDecide) {
    return (
      <p className="mt-3 text-sm font-medium" data-testid="deciding-as">
        {transfer.decidingAs === "GUARDIAN" ? `Você decide por ${transfer.person.name}.` : "Você decide por si."}
      </p>
    );
  }
  return (
    <p className="mt-3 text-sm text-muted-foreground" data-testid="read-only-note">
      Você não pode decidir este pedido. Quem decide é o responsável, quando a pessoa é menor de idade, ou a própria
      pessoa, quando é maior de idade. Você acompanha o andamento por aqui.
    </p>
  );
}

function ContestList({ transfer }: { transfer: PersonTransferView }) {
  if (transfer.contests.length === 0) return null;
  const pending = transfer.status === "PENDING_PERSON";
  return (
    <div className="mt-4 rounded-md border border-border p-3" data-testid="transfer-contests">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Info size={15} />
        {transfer.contests.length === 1 ? "O grupo antigo registrou um aviso" : "O grupo antigo registrou avisos"}
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {transfer.contests.map((contest) => (
          <li key={contest.id}>
            <strong>{CONTEST_LABEL[contest.reason]}</strong>
            <span className="text-muted-foreground">
              {" "}
              · {contest.organization.name} · {day(contest.createdAt)}
            </span>
            {contest.note && <p className="mt-1">{contest.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {pending ? "São apenas informativos e não impedem a sua decisão." : "Eram apenas informativos e não impediram a decisão."}
      </p>
    </div>
  );
}

/** Confirmação explícita ANTES de aprovar/recusar: deixa claro o que muda. */
function ConfirmPanel({
  transfer,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  transfer: PersonTransferView;
  action: "approve" | "decline";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const from = transfer.fromOrganization.name;
  const to = transfer.toOrganization.name;
  const guardian = transfer.decidingAs === "GUARDIAN";
  const matricula = guardian ? `A matrícula de ${transfer.person.name}` : "Sua matrícula";
  const historico = guardian ? `o histórico de ${transfer.person.name}` : "o seu histórico";
  return (
    <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4" role="group" aria-label="Confirmação" data-testid="transfer-confirm">
      {action === "approve" ? (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={16} />
            Antes de aprovar, confira o que muda
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            <li>
              O grupo <strong>{to}</strong> passará a ver, somente para leitura, {historico} em <strong>{from}</strong>:{" "}
              <strong>{sharedList(transfer)}</strong>.
            </li>
            <li>
              O <strong>financeiro nunca é compartilhado</strong>: mensalidades e pagamentos continuam só com o grupo que os emitiu.
            </li>
            <li>
              {matricula} em <strong>{from}</strong> será encerrada.
            </li>
            <li>
              {guardian ? `${transfer.person.name} passará` : "Você passará"} a ter matrícula em <strong>{to}</strong>
              {transfer.toUnit ? ` (${transfer.toUnit.name})` : ""} e poderá entrar no aplicativo escolhendo esse grupo.
            </li>
          </ul>
          {transfer.contests.length > 0 && (
            <p className="mt-3 text-sm">
              Os avisos do grupo antigo mostrados acima são informativos: <strong>eles não impedem</strong> a aprovação.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">Recusar este pedido?</p>
          <p className="mt-2 text-sm">
            Nada muda. {matricula} em <strong>{from}</strong> continua e <strong>{to}</strong> não passa a ver {historico}.
          </p>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={action === "approve" ? "default" : "destructive"}
          disabled={busy}
          onClick={onConfirm}
        >
          {action === "approve" ? <Check /> : <X />}
          {busy ? "Enviando…" : action === "approve" ? "Confirmar aprovação" : "Confirmar recusa"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Voltar
        </Button>
      </div>
    </div>
  );
}

export function TransferCard({ transfer }: { transfer: PersonTransferView }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<"approve" | "decline" | null>(null);

  const decide = useMutation({
    mutationFn: (action: "approve" | "decline") =>
      api.post<PersonTransferView>(`/people/me/transfers/${transfer.id}/${action}`),
    onSuccess: async (_view, action) => {
      setConfirming(null);
      // A aprovação muda matrículas/grupos: tudo que depende da ficha e do aluno precisa recarregar.
      await Promise.all(
        [["people"], ["notifications"], ["students"], ["passport"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      toast.success(
        action === "approve"
          ? `Transferência aprovada. ${transfer.toOrganization.name} já aparece nas matrículas; ao entrar no aplicativo, escolha esse grupo.`
          : "Pedido recusado. Nada mudou na matrícula atual.",
      );
    },
    onError: async (error) => {
      setConfirming(null);
      toast.error(decisionErrorMessage(error));
      // 404/409: o estado real mudou no servidor; recarrega a lista para refletir.
      await queryClient.invalidateQueries({ queryKey: ["people", "me", "transfers"] });
    },
  });

  const pending = transfer.status === "PENDING_PERSON";
  return (
    <article className="notice-item" data-testid="transfer-card" data-transfer-id={transfer.id}>
      <div className="flex items-start gap-3">
        <Avatar name={transfer.person.name} src={transfer.person.photo} size={44} decorative />
        <div className="min-w-0 flex-1">
          <h3 className="truncate">{transfer.person.name}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-sm">
            <strong>{transfer.fromOrganization.name}</strong>
            <ArrowRight size={14} aria-label="para" />
            <strong>{transfer.toOrganization.name}</strong>
            {transfer.toUnit && <span className="text-muted-foreground">({transfer.toUnit.name})</span>}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pedido em {day(transfer.requestedAt)}
            {pending ? ` · decida até ${day(transfer.expiresAt)}` : transfer.decidedAt ? ` · decidido em ${day(transfer.decidedAt)}` : ""}
          </p>
        </div>
        <span className={`badge ${pending ? "badge-warm" : ""}`} data-testid="transfer-status">
          {STATUS_LABEL[transfer.status]}
        </span>
      </div>
      {transfer.note && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Recado do grupo novo: </span>
          {transfer.note}
        </p>
      )}
      <DecidingNote transfer={transfer} />
      <ContestList transfer={transfer} />
      {pending && transfer.canDecide && confirming === null && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setConfirming("approve")}>
            <Check />
            Aprovar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming("decline")}>
            <X />
            Recusar
          </Button>
        </div>
      )}
      {pending && transfer.canDecide && confirming !== null && (
        <ConfirmPanel
          transfer={transfer}
          action={confirming}
          busy={decide.isPending}
          onConfirm={() => decide.mutate(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </article>
  );
}

export function TransfersPage() {
  const transfers = useTransfers();
  const list = transfers.data ?? [];
  const pending = pendingTransfersOf(list);
  const rest = list.filter((t) => !pending.includes(t));
  const waitingOthers = rest.filter((t) => t.status === "PENDING_PERSON");
  const history = rest.filter((t) => t.status !== "PENDING_PERSON");

  return (
    <>
      <PageHeading title="Pedidos de transferência" subtitle="Quando outro grupo pede para receber um capoeirista, a decisão é da pessoa (ou do responsável)." />
      {transfers.isLoading ? (
        <StateMessage>Carregando pedidos…</StateMessage>
      ) : transfers.error ? (
        <StateMessage tone="error">{errorMessage(transfers.error, "Não foi possível carregar os pedidos de transferência.")}</StateMessage>
      ) : list.length === 0 ? (
        <StateMessage>Nenhum pedido de transferência por enquanto.</StateMessage>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <h2 className="mb-3 text-base font-semibold">Aguardando a sua decisão ({pending.length})</h2>
              <div className="notice-list" data-testid="transfers-pending">
                {pending.map((t) => (
                  <TransferCard key={t.id} transfer={t} />
                ))}
              </div>
            </>
          )}
          {waitingOthers.length > 0 && (
            <>
              <h2 className="mb-3 text-base font-semibold">Aguardando outra pessoa</h2>
              <div className="notice-list">
                {waitingOthers.map((t) => (
                  <TransferCard key={t.id} transfer={t} />
                ))}
              </div>
            </>
          )}
          {history.length > 0 && (
            <>
              <h2 className="mb-3 text-base font-semibold">Histórico</h2>
              <div className="notice-list">
                {history.map((t) => (
                  <TransferCard key={t.id} transfer={t} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Atalho com selo (Perfil e Notificações). Sem nenhum pedido (ou erro/backend antigo) não renderiza nada. */
export function TransfersShortcut({ className = "content-band" }: { className?: string }) {
  const { data } = useTransfers();
  const count = usePendingTransferCount();
  if (!data || data.length === 0) return null;
  return (
    <section className={className} data-testid="transfers-shortcut">
      <Link to="/transferencias" className="flex items-center gap-3 no-underline">
        <div className="min-w-0 flex-1">
          <strong className="block text-base">Pedidos de transferência</strong>
          <span className="text-sm text-muted-foreground">
            {count > 0
              ? `${count} ${count === 1 ? "pedido aguardando" : "pedidos aguardando"} a sua decisão`
              : "Acompanhe os pedidos e o histórico"}
          </span>
        </div>
        {count > 0 && (
          <span className="pill-count" data-testid="transfers-badge" aria-label={`${count} pendentes`}>
            {count > 9 ? "9+" : count}
          </span>
        )}
        <ChevronRight size={16} className="flex-none text-muted-foreground" />
      </Link>
    </section>
  );
}
