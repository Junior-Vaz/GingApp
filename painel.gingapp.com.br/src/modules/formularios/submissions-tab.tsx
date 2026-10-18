import { useState } from "react";
import { CheckCircle2, Clock, Copy, Hourglass, Paperclip, Users, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ExportCsvButton } from "@/components/painel/export-csv-button";
import { StatCard } from "@/components/painel/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { NativeSelect } from "@/modules/rodas/native-select";
import { ApiError } from "@/lib/api";
import {
  FORBIDDEN_MESSAGE,
  formsErrorMessage,
  useIsMestre,
  useSubmissions,
  useSummary,
} from "./api";
import { copyText } from "./share";
import { SubmissionSheet } from "./submission-sheet";
import { formatDateTime } from "./submission-utils";
import {
  PAYMENT_STATUS_LABEL,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_VARIANT,
  type Id,
  type PaymentStatus,
  type SubmissionListItem,
  type SubmissionStatus,
} from "./types";

const STATUSES = Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[];
const PAYMENTS = Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[];

interface SubmissionsTabProps {
  formId: Id;
  /** Link público do servidor; `null` até o formulário ser publicado. */
  link: string | null;
  /** Formulário arquivado: lista e detalhe continuam, mas sem ações. */
  readOnly: boolean;
  /** `false` enquanto o formulário ainda é rascunho sem link ativo (só muda o texto do estado vazio). */
  published: boolean;
}

/** Aba "Inscrições": resumo, filtros, lista paginada, detalhe com comprovante e ações, e exportação CSV. */
export function SubmissionsTab({ formId, link, readOnly, published }: SubmissionsTabProps) {
  const lp = useListParams({ pageSize: 10, filters: { status: "", paymentStatus: "" } });
  const summary = useSummary(formId);
  const list = useSubmissions(formId, lp.params);
  const [openId, setOpenId] = useState<Id | null>(null);
  const isMestre = useIsMestre();

  const noFilters = !lp.filters.status && !lp.filters.paymentStatus && !lp.query;
  const s = summary.data;
  const shareable = published && link !== null;
  // O CSV respeita os filtros atuais da tela (o backend lê status, paymentStatus e q).
  const csvParams = {
    status: lp.filters.status,
    paymentStatus: lp.filters.paymentStatus,
    q: lp.query.trim(),
  };

  const columns: Column<SubmissionListItem>[] = [
    {
      id: "name",
      header: "Nome",
      sortValue: (item) => item.name,
      cell: (item) => (
        <button
          type="button"
          className="inline-flex min-h-11 items-center text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
          aria-label={`Abrir inscrição de ${item.name}`}
          onClick={() => setOpenId(item.id)}
        >
          {item.name}
        </button>
      ),
    },
    {
      id: "protocol",
      header: "Protocolo",
      sortValue: (item) => item.protocol,
      cell: (item) => <span className="font-mono text-xs">{item.protocol}</span>,
    },
    {
      id: "createdAt",
      header: "Enviada em",
      sortValue: (item) => item.createdAt,
      cell: (item) => formatDateTime(item.createdAt),
    },
    {
      id: "status",
      header: "Situação",
      sortValue: (item) => item.status,
      cell: (item) => (
        <Badge variant={SUBMISSION_STATUS_VARIANT[item.status]}>
          {SUBMISSION_STATUS_LABEL[item.status]}
        </Badge>
      ),
    },
    {
      id: "payment",
      header: "Pagamento",
      sortValue: (item) => item.paymentStatus,
      cell: (item) => (
        <Badge variant={item.paymentStatus === "PENDING" ? "destructive" : "outline"}>
          {PAYMENT_STATUS_LABEL[item.paymentStatus]}
        </Badge>
      ),
    },
    {
      id: "files",
      header: "Comprovante",
      sortValue: (item) => (item.hasFiles ? 1 : 0),
      cell: (item) =>
        item.hasFiles ? (
          <span className="inline-flex items-center gap-1 text-xs">
            <Paperclip className="size-4" aria-hidden /> <span>Com anexo</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const empty = !list.isLoading && !list.error && list.total === 0 && noFilters;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section
        aria-label="Resumo das inscrições"
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        data-testid="submissions-summary"
      >
        {summary.isLoading ? (
          Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : summary.error ? (
          <div
            className="col-span-full flex flex-wrap items-center gap-2 text-sm text-destructive"
            role="alert"
          >
            {formsErrorMessage(summary.error, "Não foi possível carregar o resumo.")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void summary.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        ) : s ? (
          <>
            <StatCard label="Total" value={s.total} icon={Users} />
            <StatCard
              label="Pendentes"
              value={s.byStatus.PENDING}
              icon={Clock}
              tone={s.byStatus.PENDING > 0 ? "danger" : "default"}
              hint={
                s.paymentPending > 0
                  ? `${String(s.paymentPending)} aguardando pagamento`
                  : undefined
              }
            />
            <StatCard
              label="Confirmadas"
              value={s.byStatus.CONFIRMED}
              icon={CheckCircle2}
              hint={
                s.byStatus.WAITLIST > 0
                  ? `${String(s.byStatus.WAITLIST)} na lista de espera`
                  : undefined
              }
            />
            <StatCard
              label="Pagas"
              value={s.paymentConfirmed}
              icon={Wallet}
              hint={formatCurrency(s.paidCents)}
            />
            <StatCard
              label="Vagas restantes"
              value={s.spotsLeft === null ? "Sem limite" : s.spotsLeft}
              icon={Hourglass}
            />
          </>
        ) : null}
      </section>

      {isMestre && s?.retention?.mode === "dry-run" && (
        <p
          role="status"
          className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
          data-testid="retention-dry-run"
        >
          {`A limpeza automática de dados (retenção de ${String(s.retention.months)} meses) está em modo de teste neste servidor e ainda não apaga nada. Fale com quem administra o servidor.`}
        </p>
      )}

      {empty ? (
        <div
          className="grid justify-items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-10 text-center"
          data-testid="submissions-empty"
        >
          <Users className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">Nenhuma inscrição ainda. Compartilhe o link!</p>
          <p className="max-w-md break-all text-sm text-muted-foreground">
            {shareable ? link : "Publique o formulário para o link começar a receber inscrições."}
          </p>
          {shareable && (
            <Button type="button" onClick={() => void copyText(link)}>
              <Copy /> Copiar link
            </Button>
          )}
        </div>
      ) : (
        <>
          {isMestre && (
            <div className="flex justify-end">
              {/* Exportar CSV é só do Mestre (403 para os demais). A rota lê status, paymentStatus e q. */}
              <ExportCsvButton
                path={`/event-forms/${String(formId)}/submissions/export.csv`}
                params={csvParams}
                filename="inscricoes"
                label="Exportar CSV (filtro atual)"
                friendlyError={(error) =>
                  error instanceof ApiError && error.status === 403
                    ? FORBIDDEN_MESSAGE.csv
                    : undefined
                }
              />
            </div>
          )}
          <DataTable
            columns={columns}
            data={list.items}
            server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            getRowId={(item) => String(item.id)}
            searchPlaceholder="Buscar por nome, e-mail ou protocolo…"
            emptyMessage="Nenhuma inscrição com esses filtros."
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  aria-label="Filtrar por situação"
                  className="h-11 w-48 md:h-9"
                  value={lp.filters.status}
                  onChange={(e) => lp.setFilter("status", e.target.value)}
                >
                  <option value="">Todas as situações</option>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {SUBMISSION_STATUS_LABEL[status]}
                    </option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="Filtrar por pagamento"
                  className="h-11 w-52 md:h-9"
                  value={lp.filters.paymentStatus}
                  onChange={(e) => lp.setFilter("paymentStatus", e.target.value)}
                >
                  <option value="">Todos os pagamentos</option>
                  {PAYMENTS.map((payment) => (
                    <option key={payment} value={payment}>
                      {PAYMENT_STATUS_LABEL[payment]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            }
          />
        </>
      )}

      <SubmissionSheet
        formId={formId}
        submissionId={openId}
        readOnly={readOnly}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
