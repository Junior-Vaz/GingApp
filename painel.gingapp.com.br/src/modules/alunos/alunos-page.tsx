import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { createCrud } from "@/lib/crud";
import { dayOnly, fmt } from "@/lib/format";
import { NativeSelect } from "./native-select";
import {
  STUDENT_STATUS_LABEL,
  emptyStudentForm,
  isMinor,
  studentSchema,
  studentToForm,
  studentToPayload,
  type Student,
  type StudentFormValues,
  type StudentInput,
  type StudentStatus,
  type Unit,
} from "./schema";

const students = createCrud<Student, StudentInput>("/students", {
  created: "Aluno cadastrado.",
  updated: "Aluno atualizado.",
  removed: "Aluno inativado.",
});
const units = createCrud<Unit>("/units");

export function AlunosPage() {
  const list = students.useList();
  const unitList = units.useList();
  const create = students.useCreate();
  const update = students.useUpdate();
  const remove = students.useRemove();
  const [editing, setEditing] = useState<Student | "new" | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [statusFilter, setStatusFilter] = useState<StudentStatus | "">("");

  const unitName = useMemo(() => {
    const map = new Map((unitList.data ?? []).map((u) => [u.id, u.name]));
    return (id: number | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [unitList.data]);

  const rows = useMemo(
    () => (list.data ? list.data.filter((s) => !statusFilter || s.status === statusFilter) : undefined),
    [list.data, statusFilter],
  );

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
        data={rows}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(s) => s.id}
        searchText={(s) => [s.name, s.document, s.phone, s.email].filter(Boolean).join(" ")}
        searchPlaceholder="Buscar por nome, documento, telefone…"
        emptyMessage="Nenhum aluno cadastrado ainda."
        toolbar={
          <NativeSelect
            aria-label="Filtrar por status"
            className="w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StudentStatus | "")}
          >
            <option value="">Todos os status</option>
            {Object.entries(STUDENT_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        }
        rowActions={(s) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
              Editar
            </Button>
            {s.status !== "INACTIVE" && (
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
            ? update.mutateAsync({ id: editing.id, data: studentToPayload(values) })
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
                  <FormLabel>Unidade</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="">—</option>
                      {(unitList.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormControl>
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
