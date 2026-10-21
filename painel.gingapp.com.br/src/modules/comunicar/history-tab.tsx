import { useState } from "react";
import { Pin } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/lib/list-params";
import { plural } from "@/lib/plural";
import { NativeSelect } from "@/modules/alunos/native-select";
import { useCommunications } from "./api";
import { CommunicationSheet } from "./detail-sheet";
import { STATUS_LABEL, SCOPE_LABEL, type CommStatus, type CommunicationItem } from "./types";
import { STATUS_VARIANT, whenOf } from "./utils";

const STATUSES = Object.keys(STATUS_LABEL) as CommStatus[];

/** Aba "Histórico": mensagens enviadas e agendadas, com alcance, lidos e confirmados; o detalhe abre ao lado. */
export function HistoryTab() {
  const lp = useListParams({ pageSize: 10, filters: { status: "" } });
  const list = useCommunications(lp.params);
  const [openId, setOpenId] = useState<number | null>(null);

  const columns: Column<CommunicationItem>[] = [
    {
      id: "title",
      header: "Mensagem",
      sortValue: (c) => c.title,
      cell: (c) => (
        <div className="min-w-0 space-y-0.5">
          <button
            type="button"
            className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpenId(c.id)}
          >
            {c.title}
          </button>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {c.createdByName ?? "autor removido"}
            {c.pinToFeed && (
              <span className="inline-flex items-center gap-0.5">
                <Pin className="size-3" aria-hidden /> Fixada no feed
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      id: "status",
      header: "Situação",
      sortValue: (c) => c.status,
      cell: (c) => <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>,
    },
    { id: "scope", header: "Alcance", sortValue: (c) => SCOPE_LABEL[c.scopeType], cell: (c) => SCOPE_LABEL[c.scopeType] ?? c.scopeType },
    { id: "when", header: "Data", sortValue: (c) => c.sentAt ?? c.scheduledAt ?? c.createdAt, cell: whenOf },
    { id: "recipients", header: "Destinatários", sortValue: (c) => c.recipientsCount, cell: (c) => plural(c.recipientsCount, "pessoa") },
    {
      id: "read",
      header: "Lidos",
      sortValue: (c) => c.readCount,
      cell: (c) => (c.status === "SENT" ? `${c.readCount} de ${c.recipientsCount}` : "—"),
    },
    {
      id: "acks",
      header: "Confirmados",
      sortValue: (c) => c.ackCount,
      cell: (c) => (c.requiresAck !== "NONE" && c.status === "SENT" ? `${c.ackCount} de ${c.recipientsCount}` : "—"),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={list.items}
        // Sem busca no servidor: só página e total (sem `query`/`onQueryChange` a caixa de busca não aparece).
        server={{
          page: lp.page,
          pageSize: lp.pageSize,
          onPageChange: lp.setPage,
          total: list.total,
          isFetching: list.isFetching,
        }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(c) => String(c.id)}
        rowActions={(c) => (
          <Button type="button" variant="ghost" size="sm" aria-label={`Ver detalhes de ${c.title}`} onClick={() => setOpenId(c.id)}>
            Detalhes
          </Button>
        )}
        emptyMessage={
          lp.filters.status
            ? "Nenhuma mensagem com essa situação."
            : "Nenhuma mensagem ainda. Use a aba “Nova mensagem” para enviar a primeira."
        }
        toolbar={
          <NativeSelect
            aria-label="Filtrar por situação"
            className="h-11 w-48 md:h-9"
            value={lp.filters.status}
            onChange={(e) => lp.setFilter("status", e.target.value)}
          >
            <option value="">Todas as situações</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <CommunicationSheet id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
