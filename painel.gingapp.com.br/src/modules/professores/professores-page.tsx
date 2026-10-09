import { useState } from "react";
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
import { useListParams } from "@/lib/list-params";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  TEACHER_ROLE_LABEL,
  TEACHER_STATUS_LABEL,
  createPayload,
  createTeacherSchema,
  editPayload,
  editTeacherSchema,
  emptyTeacherForm,
  teacherToForm,
  type Teacher,
  type TeacherFormValues,
  type TeacherInput,
} from "./schema";

const teachers = createCrud<Teacher, TeacherInput>("/teachers", {
  created: "Professor cadastrado.",
  updated: "Professor atualizado.",
  removed: "Professor inativado.",
});

export function ProfessoresPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { role: "", status: "" } });
  const list = teachers.usePage(lp.params);
  const create = teachers.useCreate();
  const update = teachers.useUpdate();
  const remove = teachers.useRemove();
  // PROFESSOR só tem teachers:view (seed): sem criar, editar nem inativar - backend responderia 403.
  const canCreate = useCan("teachers", "create");
  const canEdit = useCan("teachers", "edit");
  const canDelete = useCan("teachers", "delete");
  const [editing, setEditing] = useState<Teacher | "new" | null>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);

  const columns: Column<Teacher>[] = [
    { id: "name", header: "Nome", sortValue: (t) => t.user.name, cell: (t) => <span className="font-medium">{t.user.name}</span> },
    { id: "email", header: "E-mail", sortValue: (t) => t.user.email, cell: (t) => t.user.email },
    { id: "phone", header: "Telefone", cell: (t) => t.user.phone || "—" },
    {
      id: "role",
      header: "Papel",
      sortValue: (t) => TEACHER_ROLE_LABEL[t.role],
      cell: (t) => <Badge variant="outline">{TEACHER_ROLE_LABEL[t.role]}</Badge>,
    },
    {
      id: "status",
      header: "Status",
      sortValue: (t) => TEACHER_STATUS_LABEL[t.status] ?? t.status,
      cell: (t) => (
        <Badge variant={t.status === "ACTIVE" ? "default" : "secondary"}>
          {TEACHER_STATUS_LABEL[t.status] ?? t.status}
        </Badge>
      ),
    },
  ];

  const isNew = editing === "new";

  return (
    <>
      <PageHeader
        title="Professores"
        description="Mestres e professores do grupo."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Novo professor
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(t) => t.id}
        searchPlaceholder="Buscar por nome ou e-mail…"
        emptyMessage={
          lp.filters.role || lp.filters.status ? "Nenhum professor com esses filtros." : "Nenhum professor cadastrado ainda."
        }
        toolbar={
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Filtrar por papel"
              className="w-44"
              value={lp.filters.role}
              onChange={(e) => lp.setFilter("role", e.target.value)}
            >
              <option value="">Todos os papéis</option>
              <option value="PROFESSOR">Professor</option>
              <option value="MESTRE">Mestre</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por status"
              className="w-44"
              value={lp.filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </NativeSelect>
          </div>
        }
        rowActions={
          canEdit || canDelete
            ? (t) => (
                <>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                      Editar
                    </Button>
                  )}
                  {canDelete && t.status === "ACTIVE" && (
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(t)}>
                      Inativar
                    </Button>
                  )}
                </>
              )
            : undefined
        }
      />

      <FormDialog<TeacherFormValues>
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isNew ? "Novo professor" : "Editar professor"}
        schema={isNew ? createTeacherSchema : editTeacherSchema}
        defaultValues={editing && editing !== "new" ? teacherToForm(editing) : emptyTeacherForm}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: editPayload(values) })
            : create.mutateAsync(createPayload(values))
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} disabled={!isNew} />
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
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Papel</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="PROFESSOR">Professor</option>
                      <option value="MESTRE">Mestre</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isNew ? (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha inicial</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="ACTIVE">Ativo</option>
                        <option value="INACTIVE">Inativo</option>
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
        title="Inativar professor?"
        description={deleting ? `"${deleting.user.name}" será marcado como inativo. O histórico é preservado.` : undefined}
        confirmLabel="Inativar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
