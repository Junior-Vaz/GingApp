import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, AlertTriangle, CalendarPlus } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { StudentPicker } from "@/components/painel/student-picker";
import { StatCard } from "@/components/painel/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";
import { api, buildQuery, type QueryParams } from "@/lib/api";
import { useListParams } from "@/lib/list-params";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { currentMonth, formatMonth } from "./collection";
import { finance, useDelinquentsSummary, useFinanceActions } from "./finance-api";
import { InadimplentesPanel } from "./inadimplentes-panel";
import { PayDialog } from "./pay-dialog";
import { ReceiptDialog } from "./receipt-dialog";
import {
  PAYMENT_METHOD_LABEL,
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

const generateSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Escolha o mês (AAAA-MM)."),
});
type GenerateValues = z.infer<typeof generateSchema>;

export function FinanceiroPage() {
  // Lista no servidor (padrao Alunos): useListParams -> usePage -> DataTable server.
  const lp = useListParams<FinanceFilters>({ pageSize: 10, filters: emptyFinanceFilters() });
  const list = finance.usePage(lp.params);
  // Mesmos filtros + busca da lista; limit/offset ficam de fora (o summary agrega tudo).
  const summary = useFinanceSummary({ ...lp.filters, q: lp.params["q"] });
  // Destaque de inadimplência (E07): sempre o total do grupo, independente dos filtros da lista.
  const delinquents = useDelinquentsSummary();
  const create = finance.useCreate();
  const update = finance.useUpdate();
  const remove = finance.useRemove();
  const { refund, cancel, generate } = useFinanceActions();

  const [tab, setTab] = useState<"lancamentos" | "inadimplentes">("lancamentos");
  const [editing, setEditing] = useState<FinanceRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<FinanceRecord | null>(null);
  const [paying, setPaying] = useState<FinanceRecord | null>(null);
  const [refunding, setRefunding] = useState<FinanceRecord | null>(null);
  const [cancelling, setCancelling] = useState<FinanceRecord | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

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
      cell: (r) => (
        <span>
          {formatDueDate(r.paidAt)}
          {r.status === "PAID" && r.paymentMethod && (
            <span className="ml-1 text-xs text-muted-foreground">({PAYMENT_METHOD_LABEL[r.paymentMethod]})</span>
          )}
        </span>
      ),
    },
  ];

  const { filters } = lp;
  const hasFilter = !!(filters.status || filters.studentId || filters.from || filters.to);
  const totals = summary.data;
  const late = delinquents.data;

  /** "Ver lançamentos" da aba Inadimplentes: volta à lista filtrada pelo aluno e pelos atrasados. */
  const viewRecordsOf = (studentId: number) => {
    lp.setFilter("studentId", String(studentId));
    lp.setFilter("status", "OVERDUE");
    setTab("lancamentos");
  };

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Mensalidades e cobranças do grupo."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setGenerating(true)}>
              <CalendarPlus /> Gerar mensalidades do mês
            </Button>
            <Button onClick={() => setEditing("new")}>Novo lançamento</Button>
          </div>
        }
      />

      {late && late.students > 0 && (
        <div
          role="status"
          data-testid="delinquents-highlight"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
        >
          <AlertTriangle className="size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <strong className="text-sm">{late.students} aluno(s) inadimplente(s)</strong>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(late.overdueCents)} em atraso, em {late.overdueCount} lançamento(s).
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTab("inadimplentes")}>
            Ver inadimplentes
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="inadimplentes">
            Inadimplentes{late && late.students > 0 ? ` (${late.students})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lancamentos" className="mt-4">
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
                {(r.status === "PENDING" || r.status === "OVERDUE") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPaying(r)}
                    aria-label={`Dar baixa em ${r.description}`}
                  >
                    Dar baixa
                  </Button>
                )}
                {r.status === "PAID" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setReceiptId(r.id)} aria-label={`Recibo de ${r.description}`}>
                      Recibo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRefunding(r)} aria-label={`Estornar ${r.description}`}>
                      Estornar
                    </Button>
                  </>
                )}
                {(r.status === "PENDING" || r.status === "OVERDUE") && (
                  <Button variant="ghost" size="sm" onClick={() => setCancelling(r)} aria-label={`Cancelar ${r.description}`}>
                    Cancelar
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>
                  Excluir
                </Button>
              </>
            )}
          />
        </TabsContent>

        <TabsContent value="inadimplentes" className="mt-4">
          <InadimplentesPanel onViewRecords={viewRecordsOf} />
        </TabsContent>
      </Tabs>

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

      <FormDialog<GenerateValues>
        open={generating}
        onOpenChange={setGenerating}
        title="Gerar mensalidades do mês"
        description="Cria uma mensalidade para cada aluno ativo com valor definido. Pode repetir sem medo: quem já tem a mensalidade do mês é ignorado."
        schema={generateSchema}
        defaultValues={{ month: currentMonth() }}
        submitLabel="Gerar"
        onSubmit={(values) => generate.mutateAsync(values.month)}
      >
        {(form) => (
          <FormField
            control={form.control}
            name="month"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mês de competência</FormLabel>
                <FormControl>
                  <Input type="month" {...field} />
                </FormControl>
                <FormDescription>
                  {/^\d{4}-\d{2}$/.test(field.value)
                    ? `Vencimento no dia cadastrado de cada aluno em ${formatMonth(field.value)} (dia 31 vira o último dia de meses curtos).`
                    : "Escolha o mês."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </FormDialog>

      <PayDialog record={paying} onClose={() => setPaying(null)} />
      <ReceiptDialog recordId={receiptId} onClose={() => setReceiptId(null)} />

      <ConfirmDialog
        open={refunding !== null}
        onOpenChange={(open) => !open && setRefunding(null)}
        title="Estornar pagamento?"
        description={
          refunding
            ? `"${refunding.description}" (${formatCurrency(refunding.amountCents)}) volta a ficar pendente e a data e a forma de pagamento são removidas.`
            : undefined
        }
        confirmLabel="Estornar"
        onConfirm={() => refund.mutateAsync(refunding!.id)}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancelar lançamento?"
        description={
          cancelling
            ? `"${cancelling.description}" (${formatCurrency(cancelling.amountCents)}) deixa de ser cobrado e sai dos totais. O registro é mantido.`
            : undefined
        }
        confirmLabel="Cancelar lançamento"
        cancelLabel="Voltar"
        onConfirm={() => cancel.mutateAsync(cancelling!.id)}
      />

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
