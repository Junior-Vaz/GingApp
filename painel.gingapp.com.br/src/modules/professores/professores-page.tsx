import { useState } from "react";
import { KeyRound, MapPin, Plus } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ResetPasswordDialog } from "@/components/painel/account-dialogs";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import { units as unitsCrud } from "@/modules/unidades/units";
import { UnidadesAtuacaoDialog } from "./unidades-atuacao-dialog";
import {
  TEACHER_ROLE_LABEL,
  TEACHER_STATUS_LABEL,
  createPayload,
  createTeacherSchema,
  editPayload,
  editTeacherSchema,
  emptyTeacherForm,
  teacherToForm,
  unitsSummary,
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
  const [resetting, setResetting] = useState<Teacher | null>(null);
  const [assigningUnits, setAssigningUnits] = useState<Teacher | null>(null);
  // Unidades do grupo (nomes da coluna e checkboxes do diálogo "Unidades de atuação").
  const unitsQuery = unitsCrud.useList({ limit: 200 });
  const allUnits = unitsQuery.data ?? [];
  // POST /teachers/:id/reset-password (204): só o Mestre (teachers:edit) e só para PROFESSOR do próprio grupo.
  const resetPassword = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      api.post<void>(`/teachers/${id}/reset-password`, { newPassword }),
    onSuccess: () => toast.success("Senha redefinida. As sessões abertas do professor foram encerradas."),
    onError: (error) => notifyError(error),
  });

  const columns: Column<Teacher>[] = [
    { id: "name", header: "Nome", sortValue: (t) => t.user.name, cell: (t) => <span className="font-medium">{t.user.name}</span> },
    { id: "email", header: "E-mail", sortValue: (t) => t.user.email, cell: (t) => t.user.email },
    { id: "phone", header: "Telefone", cell: (t) => t.user.phone || "—" },
    {
      id: "units",
      header: "Unidades",
      cell: (t) => (t.role === "MESTRE" ? "Todas" : unitsSummary(t.unitIds, allUnits)),
    },
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
                  {canEdit && t.role === "PROFESSOR" && (
                    <Button variant="ghost" size="sm" onClick={() => setAssigningUnits(t)} aria-label={`Unidades de atuação de ${t.user.name}`}>
                      <MapPin /> Unidades de atuação
                    </Button>
                  )}
                  {canEdit && t.role === "PROFESSOR" && t.status === "ACTIVE" && (
                    <Button variant="ghost" size="sm" onClick={() => setResetting(t)} aria-label={`Redefinir senha de ${t.user.name}`}>
                      <KeyRound /> Redefinir senha
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

      <UnidadesAtuacaoDialog
        teacher={assigningUnits}
        units={allUnits}
        onOpenChange={(open) => !open && setAssigningUnits(null)}
      />

      <ResetPasswordDialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        title="Redefinir senha do professor"
        description={
          resetting
            ? `Defina uma senha provisória para ${resetting.user.name}. As sessões abertas dele serão encerradas e ele deverá trocar a senha no próximo acesso.`
            : undefined
        }
        onSubmit={(newPassword) => resetPassword.mutateAsync({ id: resetting!.id, newPassword })}
      />

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
