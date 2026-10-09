import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { StudentPicker } from "@/components/painel/student-picker";
import { StatCard } from "@/components/painel/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { api, buildQuery, type QueryParams } from "@/lib/api";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  STATUS_BADGE_CLASS,
  STATUS_LABEL,
  effectiveStatus,
  emptyFinanceFilters,
  emptyFinanceForm,
  financeSchema,
  formatDueDate,
  recordToForm,
  toCreatePayload,
  toUpdatePayload,
  type FinanceFilters,
  type FinanceFormValues,
  type FinanceRecord,
  type FinanceStatus,
  type FinanceSummary,
} from "./finance-utils";

type FinanceInput = Record<string, unknown>;

const finance = createCrud<FinanceRecord, FinanceInput>("/finance", {
  created: "Lançamento criado.",
  updated: "Lançamento atualizado.",
  removed: "Lançamento excluído.",
});

const nativeSelect =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function StatusBadge({ status }: { status: FinanceStatus }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_BADGE_CLASS[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Totais (Recebido / A receber / Atrasado) vindos do servidor: GET /finance/summary com os MESMOS
 * filtros da lista (status, studentId, from, to, q) e sem limit/offset. A chave fica sob o rootKey
 * do CRUD, entao criar/editar/excluir um lancamento tambem refaz os totais.
 */
function useFinanceSummary(filters: QueryParams) {
  return useQuery({
    queryKey: [...finance.rootKey, "summary", filters],
    queryFn: () => api.get<FinanceSummary>(`/finance/summary${buildQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
}

export function FinanceiroPage() {
  // Lista no servidor (padrao Alunos): useListParams -> usePage -> DataTable server.
  const lp = useListParams<FinanceFilters>({ pageSize: 10, filters: emptyFinanceFilters() });
  const list = finance.usePage(lp.params);
  // Mesmos filtros + busca da lista; limit/offset ficam de fora (o summary agrega tudo).
  const summary = useFinanceSummary({ ...lp.filters, q: lp.params["q"] });
  const create = finance.useCreate();
  const update = finance.useUpdate();
  const remove = finance.useRemove();

  const [editing, setEditing] = useState<FinanceRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<FinanceRecord | null>(null);

  // Nome do aluno vem no próprio item (GET /finance devolve `student: { id, name } | null`):
  // nenhuma chamada extra por linha.
  const studentName = (r: FinanceRecord) => r.student?.name ?? "—";

  const money = (cents: number | undefined) => (cents === undefined ? "—" : formatCurrency(cents));

  const columns: Column<FinanceRecord>[] = [
    {
      id: "description",
      header: "Descrição",
      sortValue: (r) => r.description,
      cell: (r) => (
        <span className="font-medium">
          {r.description}
          {r.type && <span className="ml-1 text-xs font-normal text-muted-foreground">({r.type})</span>}
        </span>
      ),
    },
    { id: "student", header: "Aluno", sortValue: (r) => studentName(r) },
    {
      id: "amount",
      header: "Valor",
      sortValue: (r) => r.amountCents,
      cell: (r) => formatCurrency(r.amountCents),
    },
    {
      id: "dueDate",
      header: "Vencimento",
      sortValue: (r) => r.dueDate,
      cell: (r) => formatDueDate(r.dueDate),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => STATUS_LABEL[effectiveStatus(r)],
      cell: (r) => <StatusBadge status={effectiveStatus(r)} />,
    },
    {
      id: "paidAt",
      header: "Pago em",
      sortValue: (r) => r.paidAt,
      cell: (r) => formatDueDate(r.paidAt),
    },
  ];

  const { filters } = lp;
  const hasFilter = !!(filters.status || filters.studentId || filters.from || filters.to);
  const totals = summary.data;

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Mensalidades e cobranças do grupo."
        actions={<Button onClick={() => setEditing("new")}>Novo lançamento</Button>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Recebido"
          value={money(totals?.paid)}
          icon={CheckCircle2}
          hint={totals ? `${totals.paidCount} lançamento(s)` : undefined}
        />
        <StatCard
          label="A receber"
          value={money(totals?.pending)}
          icon={Clock}
          hint={totals ? `${totals.pendingCount} lançamento(s)` : undefined}
        />
        <StatCard
          label="Atrasado"
          value={money(totals?.overdue)}
          icon={AlertTriangle}
          tone="danger"
          hint={totals ? `${totals.overdueCount} lançamento(s)` : undefined}
        />
      </div>
      {summary.error && (
        <p role="alert" data-testid="summary-error" className="-mt-4 mb-4 text-xs text-destructive">
          Não foi possível carregar os totais.
        </p>
      )}

      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(r) => r.id}
        searchPlaceholder="Buscar descrição ou tipo…"
        emptyMessage={
          hasFilter ? "Nenhum lançamento para os filtros." : "Nenhum lançamento financeiro ainda."
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar por status"
              className={cn(nativeSelect, "w-36")}
              value={filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value as FinanceFilters["status"])}
            >
              <option value="">Todos os status</option>
              {(Object.keys(STATUS_LABEL) as FinanceStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <StudentPicker
              mode="filter"
              value={filters.studentId ? Number(filters.studentId) : null}
              onChange={(student) => lp.setFilter("studentId", student ? String(student.id) : "")}
            />
            <Input
              type="date"
              aria-label="Vencimento de"
              className="w-40"
              value={filters.from}
              onChange={(e) => lp.setFilter("from", e.target.value)}
            />
            <Input
              type="date"
              aria-label="Vencimento até"
              className="w-40"
              value={filters.to}
              onChange={(e) => lp.setFilter("to", e.target.value)}
            />
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const empty = emptyFinanceFilters();
                  for (const key of Object.keys(empty) as (keyof FinanceFilters)[]) lp.setFilter(key, empty[key]);
                }}
              >
                Limpar
              </Button>
            )}
          </div>
        }
        rowActions={(r) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>
              Excluir
            </Button>
          </>
        )}
      />

      <FormDialog<FinanceFormValues>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === "new" || !editing ? "Novo lançamento" : "Editar lançamento"}
        schema={financeSchema}
        defaultValues={editing && editing !== "new" ? recordToForm(editing) : emptyFinanceForm()}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: toUpdatePayload(values) })
            : create.mutateAsync(toCreatePayload(values))
        }
      >
        {(form) => {
          const isEdit = editing !== null && editing !== "new";
          const status = form.watch("status");
          return (
            <>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field }) => (
                    <FormItem>
                      <StudentPicker
                        optional
                        value={field.value ? Number(field.value) : null}
                        onChange={(student) => field.onChange(student ? String(student.id) : "")}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <FormControl>
                        <Input placeholder="Mensalidade" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="amountReais"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (R$)</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0,00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vencimento</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {isEdit && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          <select {...field} className={nativeSelect}>
                            {(Object.keys(STATUS_LABEL) as FinanceStatus[]).map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {status === "PAID" && (
                    <FormField
                      control={form.control}
                      name="paidAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Data de pagamento</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">Em branco = data/hora atual.</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}
            </>
          );
        }}
      </FormDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir lançamento?"
        description={
          deleting
            ? `"${deleting.description}" (${formatCurrency(deleting.amountCents)}) será excluído definitivamente. Esta ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
