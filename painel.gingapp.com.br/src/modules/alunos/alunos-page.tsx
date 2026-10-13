import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUpCircle, IdCard, KeyRound, LayoutGrid, Pencil, Plus, Table2, Upload, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { ExportCsvButton } from "@/components/painel/export-csv-button";
import { PageHeader } from "@/components/painel/page-header";
import { RoleBadges } from "@/components/painel/role-badges";
import { ActionButtons, RowActions, type MaybeRowAction } from "@/components/painel/row-actions";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { maskCpfInput } from "@/lib/cpf";
import { createCrud, notifyError } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { canPromote, topRank } from "@/lib/staff-roles";
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
import { createErrorMessage, parseStudentConflict, type StudentConflict } from "./aluno-conflito";
import { AlunoConflitoDialog } from "./aluno-conflito-dialog";
import { FichaAlunoDialog } from "./ficha-aluno-dialog";
import { PromoverDialog, type PromoteTarget } from "@/modules/professores/promover-dialog";
import { useGroupRoles } from "@/modules/professores/roles-api";
import { ImportarAlunosDialog } from "./importar-alunos-dialog";
import { NativeSelect } from "./native-select";
import { ResponsaveisDialog } from "./responsaveis-dialog";
import { useStudentsView, type StudentsView } from "./students-view";
import {
  STUDENT_STATUS_LABEL,
  emptyStudentForm,
  isMinor,
  makeStudentSchema,
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
  const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "", groupRoleId: "" } });
  // Ordem A-Z por padrão (cards e tabela, em todas as páginas e filtros); o total e a paginação vêm do servidor.
  const list = students.usePage({ ...lp.params, order: "name" });
  const update = students.useUpdate();
  const remove = students.useRemove();
  const canDelete = useCan("students", "delete"); // PROFESSOR: sem students:delete (backend responde 403)
  const canCreate = useCan("students", "create"); // MONITOR: só leitura (sem "Novo aluno")
  const canEdit = useCan("students", "edit"); // acesso do aluno e responsáveis exigem students:edit
  // Cobrança mensal (E07) é do financeiro: só quem tem finance:view vê a coluna e finance:edit grava (hoje só o MESTRE).
  const canViewFinance = useCan("finance", "view");
  const canEditFinance = useCan("finance", "edit");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [accessOf, setAccessOf] = useState<Student | null>(null);
  const [guardiansOf, setGuardiansOf] = useState<Student | null>(null);
  const [fichaOf, setFichaOf] = useState<Student | null>(null);
  const [importing, setImporting] = useState(false);
  // "Promover a…" (cargos acumuláveis): só o Mestre concede; age na matrícula de aluno.
  const [promoting, setPromoting] = useState<PromoteTarget | null>(null);
  // 409 do cadastro (já no grupo / em outro grupo / possível duplicado) + os valores do formulário que o originaram.
  const [conflict, setConflict] = useState<{ conflict: StudentConflict; values: StudentFormValues } | null>(null);
  const [confirmingNew, setConfirmingNew] = useState(false);
  // Edição: o CPF chega MASCARADO do servidor; só aparece o campo de digitação se o usuário clicar em "Alterar CPF".
  const [changingCpf, setChangingCpf] = useState(false);
  const [view, setView] = useStudentsView();
  // Importação em massa é só do Mestre (backend: POST /students/import exige o MESTRE).
  const isMestre = useSessionUser()?.role === "MESTRE";
  // Cargos do grupo: opções do filtro por cargo e o que "Promover a…" pode oferecer (quem lê alunos lê a lista).
  const groupRolesQuery = useGroupRoles();

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
      sticky: true,
      className: "min-w-52",
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
      id: "staffRoles",
      header: "Cargos",
      sortValue: (s) => topRank(s.staffRoles),
      cell: (s) => (s.staffRoles && s.staffRoles.length > 0 ? <RoleBadges roles={s.staffRoles} /> : "—"),
    },
    {
      id: "birthDate",
      header: "Nascimento",
      sortValue: (s) => s.birthDate,
      cell: (s) => (s.birthDate ? fmt(dayOnly(s.birthDate), "dd/MM/yyyy") : "—"),
    },
    { id: "contact", header: "Contato", className: "whitespace-nowrap", cell: (s) => s.phone || s.email || "—" },
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
  useEffect(() => setChangingCpf(false), [editing]);
  const currentDocument = editing && editing !== "new" ? (editing.document ?? "").trim() : "";
  // Na edição, o CPF só é validado se o usuário o alterou (aluno legado com documento que não é CPF não fica preso).
  const originalDocument = editing && editing !== "new" ? editing.document : undefined;
  const formSchema = useMemo(() => makeStudentSchema(originalDocument), [originalDocument]);

  /** Cobrança: só com finance:edit, e na edição só se a cobrança atual já foi carregada. Sem mudança, nem chama. */
  async function saveBilling(student: Student, values: StudentFormValues, saved: Student | null) {
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
  }

  /**
   * POST /students. Os 409 de pessoa já existente abrem o diálogo correspondente (nada é criado); os 400 de
   * CPF/código GingApp viram toast com mensagem clara. Em qualquer erro relança, para o formulário continuar aberto.
   */
  async function createStudent(values: StudentFormValues, confirmNew = false): Promise<Student> {
    const payload = { ...studentToPayload(values), ...(confirmNew ? { confirmNew: true } : {}) };
    try {
      const student = await api.post<Student>("/students", payload);
      void queryClient.invalidateQueries({ queryKey: students.rootKey });
      toast.success("Aluno cadastrado.");
      return student;
    } catch (error) {
      const found = parseStudentConflict(error);
      if (found) setConflict({ conflict: found, values });
      else toast.error(createErrorMessage(error, "Algo deu errado. Tente novamente."));
      throw error;
    }
  }

  /** "Cadastrar mesmo assim" do possível duplicado: reenvia o MESMO corpo com confirmNew:true. */
  async function confirmNewStudent() {
    if (!conflict) return;
    setConfirmingNew(true);
    try {
      const student = await createStudent(conflict.values, true);
      await saveBilling(student, conflict.values, null);
      setConflict(null);
      setEditing(null);
    } catch {
      // erro já notificado (toast) ou novo conflito exibido
    } finally {
      setConfirmingNew(false);
    }
  }

  /** PERSON_ALREADY_IN_GROUP: busca a matrícula existente e abre para editar (ex.: reativar). */
  async function openExistingStudent(studentId: number) {
    try {
      const existing = await api.get<Student>(`/students/${studentId}`);
      setConflict(null);
      flushSync(() => setEditing(null)); // fecha o "Novo aluno" antes, para o formulário recarregar com o aluno existente
      setEditing(existing);
    } catch (error) {
      notifyError(error, "Não foi possível abrir o cadastro existente.");
    }
  }

  /**
   * Mesmas ações e permissões nos dois modos: botões com texto nos cards; na tabela, Editar e Ficha viram botões de
   * ícone e o resto vai para o menu "⋯" (a coluna Ações cabe numa linha só).
   */
  const studentActionList = (s: Student): MaybeRowAction[] => [
    canEdit && { key: "edit", label: "Editar", icon: Pencil, primary: true, onSelect: () => setEditing(s) },
    { key: "ficha", label: "Ficha", ariaLabel: `Ficha de ${s.name}`, icon: IdCard, primary: true, onSelect: () => setFichaOf(s) },
    canEdit && { key: "access", label: "Acesso", ariaLabel: `Acesso de ${s.name}`, icon: KeyRound, onSelect: () => setAccessOf(s) },
    canEdit && {
      key: "guardians",
      label: "Responsáveis",
      ariaLabel: `Responsáveis de ${s.name}`,
      icon: Users,
      onSelect: () => setGuardiansOf(s),
    },
    isMestre &&
      s.status === "ACTIVE" &&
      canPromote(groupRolesQuery.data, s.staffRoles) && {
        key: "promote",
        label: "Promover a…",
        ariaLabel: `Promover ${s.name}`,
        icon: ArrowUpCircle,
        onSelect: () => setPromoting({ studentId: s.id, name: s.name, email: s.email, roles: s.staffRoles ?? [] }),
      },
    canDelete &&
      s.status !== "INACTIVE" && { key: "deactivate", label: "Inativar", icon: UserX, destructive: true, onSelect: () => setDeleting(s) },
  ];
  const studentActions = (s: Student) => <ActionButtons actions={studentActionList(s)} />;

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
            {canCreate && (
              <Button onClick={() => setEditing("new")}>
                <Plus /> Novo aluno
              </Button>
            )}
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
        emptyMessage={
          lp.filters.status || lp.filters.unitId || lp.filters.groupRoleId ? "Nenhum aluno com esses filtros." : "Nenhum aluno cadastrado ainda."
        }
        cards={{
          active: view === "cards",
          render: (s) => (
            <StudentCard
              student={s}
              unitName={unitName(s.unitId)}
              billing={canViewFinance ? billingSummary(billingOf.get(s.id), formatCurrency) : undefined}
              actions={studentActions(s)}
              actionList={studentActionList(s)}
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
            <NativeSelect
              aria-label="Filtrar por cargo"
              className="w-44"
              value={lp.filters.groupRoleId}
              onChange={(e) => lp.setFilter("groupRoleId", e.target.value)}
            >
              <option value="">Todos os cargos</option>
              {(groupRolesQuery.data ?? []).map((role) => (
                <option key={role.id} value={String(role.id)}>
                  {role.active ? role.name : `${role.name} (inativo)`}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
        rowActions={(s) => <RowActions actions={studentActionList(s)} subject={s.name} />}
      />

      <FormDialog<StudentFormValues>
        as="sheet"
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar aluno" : "Novo aluno"}
        schema={formSchema}
        defaultValues={
          editing && editing !== "new"
            ? { ...studentToForm(editing), ...billingToFields(billingOf.get(editing.id)) }
            : emptyStudentForm
        }
        onSubmit={async (values) => {
          const saved = editing && editing !== "new" ? editing : null;
          // Edição: 409 do PATCH (documento de outra pessoa / travado) chega como toast com a mensagem do backend.
          const student = saved
            ? await update.mutateAsync({ id: saved.id, data: studentToUpdatePayload(values, saved.document) })
            : await createStudent(values);
          await saveBilling(student, values, saved);
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
            {currentDocument !== "" && !changingCpf ? (
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">CPF</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span data-testid="student-document-masked" className="font-mono text-sm">
                    {currentDocument}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setChangingCpf(true)}>
                    Alterar CPF
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Por segurança, o CPF cadastrado aparece mascarado e só é enviado de novo se você alterá-lo.
                </p>
              </div>
            ) : (
              <FormField
                control={form.control}
                name="document"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPF</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="000.000.000-00"
                        autoComplete="off"
                        {...field}
                        onChange={(e) => field.onChange(maskCpfInput(e.target.value))}
                      />
                    </FormControl>
                    {currentDocument !== "" && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => {
                          form.setValue("document", "");
                          setChangingCpf(false);
                        }}
                      >
                        Manter o CPF atual ({currentDocument})
                      </Button>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {!isEdit && (
              <>
                <FormField
                  control={form.control}
                  name="guardianDocument"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CPF do responsável (para criança sem CPF)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="000.000.000-00"
                          autoComplete="off"
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(maskCpfInput(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gingappCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Código GingApp (se a pessoa já tem)</FormLabel>
                      <FormControl>
                        <Input placeholder="GING-XXXX-XXXX" autoComplete="off" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
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
      <FichaAlunoDialog student={fichaOf} onClose={() => setFichaOf(null)} />
      <PromoverDialog target={promoting} onClose={() => setPromoting(null)} />
      <AlunoConflitoDialog
        conflict={conflict?.conflict ?? null}
        confirming={confirmingNew}
        onClose={() => setConflict(null)}
        onOpenExisting={(id) => void openExistingStudent(id)}
        onConfirmNew={() => void confirmNewStudent()}
        onTransferSent={() => {
          setConflict(null);
          setEditing(null);
        }}
      />

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
