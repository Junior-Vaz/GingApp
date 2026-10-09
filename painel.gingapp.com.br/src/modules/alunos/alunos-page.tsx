import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { useCan } from "@/lib/session";
import { dayOnly, fmt } from "@/lib/format";
import { useUnitNames } from "@/lib/unit-lookup";
import { NativeSelect } from "./native-select";
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

export function AlunosPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "" } });
  const list = students.usePage(lp.params);
  const create = students.useCreate();
  const update = students.useUpdate();
  const remove = students.useRemove();
  const canDelete = useCan("students", "delete"); // PROFESSOR: sem students:delete (backend responde 403)
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);

  // Nomes só das unidades desta página (GET /units/:id por id distinto): não depende de lista com teto.
  const nameOfUnit = useUnitNames((list.items ?? []).map((s) => s.unitId));
  const unitName = (id: number | null) => (id === null ? "—" : nameOfUnit(id, `Unidade #${id}`));

  const columns: Column<Student>[] = [
    {
      id: "name",
      header: "Nome",
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="font-medium">
          {s.name}
          {isMinor(s.birthDate) && (
            <Badge variant="outline" className="ml-2">
              Menor
            </Badge>
          )}
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

  return (
    <>
      <PageHeader
        title="Alunos"
        description="Cadastro de alunos do grupo."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Novo aluno
          </Button>
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
        toolbar={
          <div className="flex flex-wrap gap-2">
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
        rowActions={(s) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
              Editar
            </Button>
            {canDelete && s.status !== "INACTIVE" && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(s)}>
                Inativar
              </Button>
            )}
          </>
        )}
      />

      <FormDialog<StudentFormValues>
        as="sheet"
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar aluno" : "Novo aluno"}
        schema={studentSchema}
        defaultValues={editing && editing !== "new" ? studentToForm(editing) : emptyStudentForm}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: studentToUpdatePayload(values) })
            : create.mutateAsync(studentToPayload(values))
        }
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
