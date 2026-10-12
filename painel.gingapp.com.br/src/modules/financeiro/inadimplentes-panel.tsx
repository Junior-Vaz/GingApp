import { BellRing } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ExportCsvButton } from "@/components/painel/export-csv-button";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useListParams } from "@/lib/list-params";
import { formatCurrency } from "@/lib/format";
import { useUnitNames } from "@/lib/unit-lookup";
import type { DelinquentRow } from "./collection";
import { useDelinquents, useFinanceActions } from "./finance-api";
import { formatDueDate } from "./finance-utils";

type Filters = { unitId: string; from: string; to: string };
const emptyFilters = (): Filters => ({ unitId: "", from: "", to: "" });

/**
 * Inadimplentes (OVERDUE gravado + PENDING vencido, a mesma regra do financeiro) agrupados por aluno,
 * com o total atrasado, o total em aberto e o contato do aluno/responsáveis para a cobrança.
 * "Avisar atrasados" chama o FinanceOverdueService existente (POST /finance/mark-overdue).
 */
export function InadimplentesPanel({ onViewRecords }: { onViewRecords: (studentId: number) => void }) {
  const lp = useListParams<Filters>({ pageSize: 10, filters: emptyFilters() });
  const list = useDelinquents(lp.params);
  const { markOverdue } = useFinanceActions();
  const nameOfUnit = useUnitNames((list.items ?? []).map((r) => r.unitId));

  const { filters } = lp;
  const hasFilter = !!(filters.unitId || filters.from || filters.to);

  const columns: Column<DelinquentRow>[] = [
    {
      id: "student",
      header: "Aluno",
      sortValue: (r) => r.studentName,
      cell: (r) => (
        <span className="font-medium">
          {r.studentName}
          {r.unitId !== null && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">({nameOfUnit(r.unitId, `Unidade #${r.unitId}`)})</span>
          )}
        </span>
      ),
    },
    {
      id: "contact",
      header: "Contato",
      cell: (r) => (
        <div className="text-xs leading-tight">
          <div>{[r.phone, r.email].filter(Boolean).join(" · ") || "—"}</div>
          {r.guardians.map((g, index) => (
            <div key={index} className="text-muted-foreground">
              {g.name}
              {g.relationship ? ` (${g.relationship})` : ""}: {[g.phone, g.email].filter(Boolean).join(" · ") || "—"}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "overdue",
      header: "Em atraso",
      sortValue: (r) => r.overdueCents,
      cell: (r) => (
        <span className="font-semibold text-destructive">
          {formatCurrency(r.overdueCents)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">({r.overdueCount})</span>
        </span>
      ),
    },
    { id: "open", header: "Total em aberto", sortValue: (r) => r.openCents, cell: (r) => formatCurrency(r.openCents) },
    {
      id: "oldest",
      header: "Mais antigo",
      sortValue: (r) => r.oldestDueDate,
      cell: (r) => (
        <span>
          {formatDueDate(r.oldestDueDate)}
          <span className="ml-1 text-xs text-muted-foreground">({r.daysLate} dia(s))</span>
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={list.items}
      server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
      isLoading={list.isLoading}
      error={list.error}
      onRetry={() => void list.refetch()}
      getRowId={(r) => r.studentId}
      searchPlaceholder="Buscar aluno…"
      emptyMessage={hasFilter || lp.query ? "Nenhum inadimplente para os filtros." : "Nenhum aluno inadimplente."}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <UnitPicker
            mode="filter"
            value={filters.unitId ? Number(filters.unitId) : null}
            onChange={(unit) => lp.setFilter("unitId", unit ? String(unit.id) : "")}
          />
          <Input
            type="date"
            aria-label="Atrasado desde"
            className="w-40"
            value={filters.from}
            onChange={(e) => lp.setFilter("from", e.target.value)}
          />
          <Input
            type="date"
            aria-label="Atrasado até"
            className="w-40"
            value={filters.to}
            onChange={(e) => lp.setFilter("to", e.target.value)}
          />
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const empty = emptyFilters();
                for (const key of Object.keys(empty) as (keyof Filters)[]) lp.setFilter(key, empty[key]);
              }}
            >
              Limpar
            </Button>
          )}
          <ExportCsvButton
            path="/finance/delinquents/export.csv"
            filename="financeiro-inadimplentes"
            params={{ ...filters, q: lp.query.trim() }}
          />
          <Button variant="outline" size="sm" disabled={markOverdue.isPending} onClick={() => markOverdue.mutate()}>
            <BellRing /> Avisar atrasados
          </Button>
        </div>
      }
      rowActions={(r) => (
        <Button variant="ghost" size="sm" onClick={() => onViewRecords(r.studentId)} aria-label={`Ver lançamentos de ${r.studentName}`}>
          Ver lançamentos
        </Button>
      )}
    />
  );
}
