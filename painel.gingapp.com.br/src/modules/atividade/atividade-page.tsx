import { DataTable, type Column } from "@/components/painel/data-table";
import { PageHeader } from "@/components/painel/page-header";
import { Input } from "@/components/ui/input";
import { fmt, toDate } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { NativeSelect } from "@/modules/alunos/native-select";
import { ACTION_OPTIONS, activity, actionLabel, metaText, type ActivityLog } from "./atividade-api";

const columns: Column<ActivityLog>[] = [
  {
    id: "createdAt",
    header: "Data",
    cell: (l) => fmt(toDate(l.createdAt), "dd/MM/yyyy HH:mm"),
  },
  {
    id: "action",
    header: "Ação",
    cell: (l) => <span className="font-semibold">{actionLabel(l.action)}</span>,
  },
  {
    id: "user",
    header: "Responsável",
    cell: (l) => (
      <span>
        {l.userName ?? "-"}
        {l.userEmail && <span className="block text-xs text-muted-foreground">{l.userEmail}</span>}
      </span>
    ),
  },
  { id: "ip", header: "IP", cell: (l) => l.ip ?? "-" },
  {
    id: "meta",
    header: "Detalhes",
    cell: (l) => <span className="break-all font-mono text-xs text-muted-foreground">{metaText(l.meta)}</span>,
  },
];

/** "Atividade do grupo" (só o MESTRE): trilha de auditoria do próprio grupo, mais recente primeiro. */
export function AtividadePage() {
  const lp = useListParams({ pageSize: 20, filters: { action: "", from: "", to: "" } });
  const list = activity.usePage(lp.params);
  // Sem busca textual (o servidor filtra por ação e período): não repassa onQueryChange para esconder o campo.
  const { onQueryChange: _search, ...server } = lp.server;
  void _search;

  return (
    <>
      <PageHeader
        title="Atividade do grupo"
        description="Registro das ações sensíveis feitas no seu grupo: acessos, senhas, unidades, financeiro e exportações."
      />
      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(l) => l.id}
        emptyMessage="Nenhuma atividade registrada neste período."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Filtrar por ação"
              className="w-56"
              value={lp.filters.action}
              onChange={(e) => lp.setFilter("action", e.target.value)}
            >
              <option value="">Todas as ações</option>
              {ACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              aria-label="De"
              className="w-40"
              value={lp.filters.from}
              onChange={(e) => lp.setFilter("from", e.target.value)}
            />
            <Input
              type="date"
              aria-label="Até"
              className="w-40"
              value={lp.filters.to}
              onChange={(e) => lp.setFilter("to", e.target.value)}
            />
          </div>
        }
      />
    </>
  );
}
