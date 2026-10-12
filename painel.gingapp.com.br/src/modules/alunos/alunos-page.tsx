import { useState } from "react";
import { KeyRound, LayoutGrid, Plus, Table2, Upload, Users } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { ExportCsvButton } from "@/components/painel/export-csv-button";
import { PageHeader } from "@/components/painel/page-header";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { useCan, useSessionUser } from "@/lib/session";
import { dayOnly, fmt, formatCurrency } from "@/lib/format";
import { useUnitNames } from "@/lib/unit-lookup";
import {
  billingChanged,
  billingPayload,
  billingSummary,
  billingToFields,
  type StudentBilling,
} from "@/modules/financeiro/collection";
import { BILLING_KEY, useStudentBillings } from "@/modules/financeiro/finance-api";
import { AcessoAlunoDialog } from "./acesso-aluno-dialog";
import { StudentCard } from "./aluno-card";
import { ImportarAlunosDialog } from "./importar-alunos-dialog";
import { NativeSelect } from "./native-select";
import { ResponsaveisDialog } from "./responsaveis-dialog";
import { useStudentsView, type StudentsView } from "./students-view";
import {
  STUDENT_STATUS_LABEL,
  emptyStudentForm,
  isMinor,
  studentSchema,
  studentToForm,
  studentToPayload,
  studentToUpdatePayload,
  type Student,
  type StudentFormValues,
  type StudentInput,
} from "./schema";

const students = createCrud<Student, StudentInput>("/students", {
  created: "Aluno cadastrado.",
  updated: "Aluno atualizado.",
  removed: "Aluno inativado.",
});

/** Alternador "Cards | Tabela" da lista de alunos (a escolha fica salva neste navegador). */
function ViewToggle({ view, onChange }: { view: StudentsView; onChange: (view: StudentsView) => void }) {
  const options: { value: StudentsView; label: string; icon: typeof Table2 }[] = [
    { value: "cards", label: "Cards", icon: LayoutGrid },
    { value: "table", label: "Tabela", icon: Table2 },
  ];
  return (
    <div role="group" aria-label="Modo de visualização" className="inline-flex rounded-md border bg-card p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={view === value ? "default" : "ghost"}
          aria-pressed={view === value}
          className="h-8 px-3"
          onClick={() => onChange(value)}
        >
          <Icon /> {label}
        </Button>
      ))}
    </div>
  );
}

export function AlunosPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "" } });
  const list = students.usePage(lp.params);
  const create = students.useCreate();
  const update = students.useUpdate();
  const remove = students.useRemove();
  const canDelete = useCan("students", "delete"); // PROFESSOR: sem students:delete (backend responde 403)
  const canEdit = useCan("students", "edit"); // acesso do aluno e responsáveis exigem students:edit
  // Cobrança mensal (E07) é do financeiro: só quem tem finance:view vê a coluna e finance:edit grava (hoje só o MESTRE).
  const canViewFinance = useCan("finance", "view");
  const canEditFinance = useCan("finance", "edit");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [accessOf, setAccessOf] = useState<Student | null>(null);
  const [guardiansOf, setGuardiansOf] = useState<Student | null>(null);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useStudentsView();
  // Importação em massa é só do Mestre (backend: POST /students/import exige o MESTRE).
  const isMestre = useSessionUser()?.role === "MESTRE";

  // Nomes só das unidades desta página (GET /units/:id por id distinto): não depende de lista com teto.
  const nameOfUnit = useUnitNames((list.items ?? []).map((s) => s.unitId));
  const unitName = (id: number | null) => (id === null ? "—" : nameOfUnit(id, `Unidade #${id}`));

  // Valor/dia de vencimento só das linhas desta página (GET /finance/billing?studentIds=...).
  const billings = useStudentBillings((list.items ?? []).map((s) => s.id), canViewFinance);
  const billingOf = new Map<number, StudentBilling>((billings.data ?? []).map((b) => [b.studentId, b]));

  const columns: Column<Student>[] = [
    {
      id: "name",
      header: "Nome",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex items-center gap-2 font-medium">
          <StudentAvatar name={s.name} photo={s.photo} />
          <span>
            {s.name}
            {isMinor(s.birthDate) && (
              <Badge variant="outline" className="ml-2">
                Menor
              </Badge>
            )}
          </span>
        </span>
      ),
    },
    { id: "unit", header: "Unidade", sortValue: (s) => unitName(s.unitId), cell: (s) => unitName(s.unitId) },
    {
      id: "birthDate",
      header: "Nascimento",
      sortValue: (s) => s.birthDate,
      cell: (s) => (s.birthDate ? fmt(dayOnly(s.birthDate), "dd/MM/yyyy") : "—"),
    },
    { id: "contact", header: "Contato", cell: (s) => s.phone || s.email || "—" },
    ...(canViewFinance
      ? [
          {
            id: "billing",
            header: "Mensalidade",
            sortValue: (s: Student) => billingOf.get(s.id)?.monthlyFeeCents ?? null,
            cell: (s: Student) => billingSummary(billingOf.get(s.id), formatCurrency),
          } satisfies Column<Student>,
        ]
      : []),
    {
      id: "access",
      header: "Acesso",
      sortValue: (s) => (s.userId ? 1 : 0),
      cell: (s) => <Badge variant={s.userId ? "default" : "secondary"}>{s.userId ? "Com acesso" : "Sem acesso"}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (s) => STUDENT_STATUS_LABEL[s.status],
      cell: (s) => (
        <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"}>{STUDENT_STATUS_LABEL[s.status]}</Badge>
      ),
    },
  ];

  const isEdit = editing !== null && editing !== "new";

  /** Mesmas ações nos dois modos (tabela e cards), com as mesmas permissões. */
  const studentActions = (s: Student) => (
    <>
      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
        Editar
      </Button>
      {canEdit && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setAccessOf(s)} aria-label={`Acesso de ${s.name}`}>
            <KeyRound /> Acesso
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGuardiansOf(s)} aria-label={`Responsáveis de ${s.name}`}>
            <Users /> Responsáveis
          </Button>
        </>
      )}
      {canDelete && s.status !== "INACTIVE" && (
        <Button variant="ghost" size="sm" onClick={() => setDeleting(s)}>
          Inativar
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Alunos"
        description="Cadastro de alunos do grupo."
        actions={
          <div className="flex flex-wrap gap-2">
            {isMestre && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload /> Importar
              </Button>
            )}
            <ExportCsvButton
              path="/students/export.csv"
              filename="alunos"
              params={{ status: lp.filters.status, unitId: lp.filters.unitId, q: lp.query.trim() }}
            />
            <Button onClick={() => setEditing("new")}>
              <Plus /> Novo aluno
            </Button>
          </div>
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(s) => s.id}
        searchPlaceholder="Buscar por nome, documento, telefone…"
        emptyMessage={lp.filters.status || lp.filters.unitId ? "Nenhum aluno com esses filtros." : "Nenhum aluno cadastrado ainda."}
        cards={{
          active: view === "cards",
          render: (s) => (
            <StudentCard
              student={s}
              unitName={unitName(s.unitId)}
              billing={canViewFinance ? billingSummary(billingOf.get(s.id), formatCurrency) : undefined}
              actions={studentActions(s)}
            />
          ),
        }}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <ViewToggle view={view} onChange={setView} />
            <UnitPicker
              mode="filter"
              value={lp.filters.unitId ? Number(lp.filters.unitId) : null}
              onChange={(u) => lp.setFilter("unitId", u ? String(u.id) : "")}
            />
            <NativeSelect
              aria-label="Filtrar por status"
              className="w-44"
              value={lp.filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value)}
            >
              <option value="">Todos os status</option>
              {Object.entries(STUDENT_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
        rowActions={studentActions}
      />

      <FormDialog<StudentFormValues>
        as="sheet"
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar aluno" : "Novo aluno"}
        schema={studentSchema}
        defaultValues={
          editing && editing !== "new"
            ? { ...studentToForm(editing), ...billingToFields(billingOf.get(editing.id)) }
            : emptyStudentForm
        }
        onSubmit={async (values) => {
          const saved = editing && editing !== "new" ? editing : null;
          const student = saved
            ? await update.mutateAsync({ id: saved.id, data: studentToUpdatePayload(values) })
            : await create.mutateAsync(studentToPayload(values));
          // Cobrança: só com finance:edit, e na edição só se a cobrança atual já foi carregada (senão um
          // formulário "vazio" por não ter carregado apagaria a cobrança). Sem mudança, nem chama.
          const fields = { monthlyFee: values.monthlyFee ?? "", dueDay: values.dueDay ?? "" };
          const previous = saved ? billingOf.get(saved.id) : undefined;
          if (canEditFinance && (!saved || billings.isSuccess) && billingChanged(fields, previous)) {
            try {
              await api.put(`/finance/billing/${student.id}`, billingPayload(fields));
              void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
            } catch (error) {
              notifyError(error, "O aluno foi salvo, mas não foi possível salvar a mensalidade.");
            }
          }
        }}
      >
        {(form) => (
          <>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ImageUploadField<StudentFormValues>
              name="photo"
              label="Foto (URL)"
              shape="square"
              previewAlt="Foto do aluno"
              description="Opcional. Envie uma foto (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem."
            />
            <FormField
              control={form.control}
              name="unitId"
              render={({ field }) => (
                <FormItem>
                  <UnitPicker
                    optional
                    value={field.value ? Number(field.value) : null}
                    onChange={(u) => field.onChange(u ? String(u.id) : "")}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="birthDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nascimento</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="document"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Documento</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {canEditFinance && (!isEdit || billings.isSuccess) && (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="monthlyFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mensalidade (R$)</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0,00" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dia do vencimento</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder="1 a 31" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            {isEdit && (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {Object.entries(STUDENT_STATUS_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </>
        )}
      </FormDialog>

      {isMestre && <ImportarAlunosDialog open={importing} onOpenChange={setImporting} />}
      <AcessoAlunoDialog student={accessOf} onClose={() => setAccessOf(null)} />
      <ResponsaveisDialog student={guardiansOf} onClose={() => setGuardiansOf(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Inativar aluno?"
        description={deleting ? `"${deleting.name}" será marcado como inativo. O histórico é preservado.` : undefined}
        confirmLabel="Inativar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
