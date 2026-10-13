import { useState } from "react";
import { ArrowUpCircle, GraduationCap, KeyRound, MapPin, Pencil, Plus, ShieldOff, UserMinus, UserX } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ResetPasswordDialog } from "@/components/painel/account-dialogs";
import { ResetTwoFactorDialog } from "@/components/painel/reset-two-factor-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { FormDialog } from "@/components/painel/form-dialog";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { PageHeader } from "@/components/painel/page-header";
import { RoleBadges } from "@/components/painel/role-badges";
import { RowActions, type MaybeRowAction } from "@/components/painel/row-actions";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { ropeOf } from "@/lib/rope";
import { canPromote, STAFF_ROLES, STAFF_ROLE_LABEL, topRank } from "@/lib/staff-roles";
import { useCan, useSessionUser } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import { units as unitsCrud } from "@/modules/unidades/units";
import { CargosGrupo } from "./cargos-grupo";
import { PromoverDialog, type PromoteTarget } from "./promover-dialog";
import { RevogarDialog, type RevokeTarget } from "./revogar-dialog";
import { useGroupRoles } from "./roles-api";
import { SugestoesPromocao } from "./sugestoes-promocao";
import { UnidadesAtuacaoDialog } from "./unidades-atuacao-dialog";
import {
  TEACHER_STATUS_LABEL,
  createPayload,
  createTeacherSchema,
  editPayload,
  editTeacherSchema,
  emptyTeacherForm,
  teacherRoles,
  teacherToForm,
  unitsSummary,
  type Teacher,
  type TeacherFormValues,
  type TeacherInput,
} from "./schema";

const teachers = createCrud<Teacher, TeacherInput>("/teachers", {
  created: "Membro da equipe cadastrado.",
  updated: "Membro da equipe atualizado.",
  removed: "Membro da equipe inativado.",
});

/** "Equipe": mestres, professores, instrutores e monitores do grupo (cargos acumuláveis; o maior vira o acesso). */
export function ProfessoresPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { groupRoleId: "", status: "" } });
  const list = teachers.usePage(lp.params);
  const create = teachers.useCreate();
  const update = teachers.useUpdate();
  const remove = teachers.useRemove();
  // Só o MESTRE gerencia a equipe (teachers:create/edit/delete); PROFESSOR e INSTRUTOR só veem a lista (teachers:view)
  // e o MONITOR nem a tela: sem criar, editar nem inativar - backend responderia 403.
  const canCreate = useCan("teachers", "create");
  const canEdit = useCan("teachers", "edit");
  const canDelete = useCan("teachers", "delete");
  const [editing, setEditing] = useState<Teacher | "new" | null>(null);
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [resetting, setResetting] = useState<Teacher | null>(null);
  const [resetting2fa, setResetting2fa] = useState<Teacher | null>(null);
  // Redefinir o 2FA e conceder/revogar cargos é só do Mestre do grupo (o servidor responde 403 aos demais).
  const isMestre = useSessionUser()?.role === "MESTRE";
  const [assigningUnits, setAssigningUnits] = useState<Teacher | null>(null);
  // "Promover a…" e "Revogar cargo" agem na matrícula de aluno da pessoa (todo mundo é aluno).
  const [promoting, setPromoting] = useState<PromoteTarget | null>(null);
  const [revoking, setRevoking] = useState<RevokeTarget | null>(null);
  // Unidades do grupo (nomes da coluna e checkboxes do diálogo "Unidades de atuação").
  const unitsQuery = unitsCrud.useList({ limit: 200 });
  // Cargos do grupo: filtro da lista e "Promover a…" (só carrega para quem pode ver a lista de cargos).
  const groupRolesQuery = useGroupRoles();
  const groupRoles = groupRolesQuery.data ?? [];
  const allUnits = unitsQuery.data ?? [];
  // POST /teachers/:id/reset-password (204): só o Mestre (teachers:edit) e para qualquer membro da equipe que não seja Mestre.
  const resetPassword = useMutation({
    mutationFn: ({ id, newPassword }: { id: number; newPassword: string }) =>
      api.post<void>(`/teachers/${id}/reset-password`, { newPassword }),
    onSuccess: () => toast.success("Senha redefinida. As sessões abertas do membro da equipe foram encerradas."),
    onError: (error) => notifyError(error),
  });

  const columns: Column<Teacher>[] = [
    { id: "name", header: "Nome", sticky: true, className: "min-w-52", sortValue: (t) => t.user.name, cell: (t) => (
        <span className="flex items-center gap-2 font-medium">
          <EntityAvatar name={t.user.name} photo={t.user.photo} icon={GraduationCap} className="size-9" />
          {t.user.name}
        </span>
      ),
    },
    { id: "email", header: "E-mail", className: "whitespace-nowrap", sortValue: (t) => t.user.email, cell: (t) => t.user.email },
    { id: "phone", header: "Telefone", className: "whitespace-nowrap", cell: (t) => t.user.phone || "—" },
    {
      id: "units",
      header: "Unidades",
      cell: (t) => (t.role === "MESTRE" ? "Todas" : unitsSummary(t.unitIds, allUnits)),
    },
    {
      id: "role",
      header: "Cargos",
      sortValue: (t) => topRank(teacherRoles(t)),
      cell: (t) => <RoleBadges roles={teacherRoles(t)} />,
    },
    {
      id: "rope",
      header: "Corda",
      sortValue: (t) => t.student?.level?.order ?? -1,
      cell: (t) =>
        t.student?.level ? (
          <span className="inline-flex items-center gap-2">
            <RopeSwatch {...ropeOf(t.student.level)} size="sm" orientation="horizontal" />
            {t.student.level.name}
          </span>
        ) : (
          "—"
        ),
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

  /** Editar fica à vista; o resto (cargos, unidades, senha, 2FA, inativar) vai para o menu "⋯". Permissões como antes. */
  const teacherActions = (t: Teacher): MaybeRowAction[] => [
    canEdit && { key: "edit", label: "Editar", icon: Pencil, primary: true, onSelect: () => setEditing(t) },
    isMestre &&
      !!t.student &&
      t.status === "ACTIVE" &&
      t.student.status === "ACTIVE" &&
      canPromote(groupRolesQuery.data, teacherRoles(t)) && {
        key: "promote",
        label: "Promover a…",
        ariaLabel: `Promover ${t.user.name}`,
        icon: ArrowUpCircle,
        onSelect: () =>
          setPromoting({ studentId: t.student!.id, name: t.user.name, email: t.user.email, roles: teacherRoles(t) }),
      },
    isMestre &&
      !!t.student && {
        key: "revoke",
        label: "Revogar cargo",
        ariaLabel: `Revogar cargo de ${t.user.name}`,
        icon: UserMinus,
        onSelect: () => setRevoking({ studentId: t.student!.id, name: t.user.name, roles: teacherRoles(t) }),
      },
    canEdit &&
      t.role !== "MESTRE" && {
        key: "units",
        label: "Unidades de atuação",
        ariaLabel: `Unidades de atuação de ${t.user.name}`,
        icon: MapPin,
        onSelect: () => setAssigningUnits(t),
      },
    canEdit &&
      t.role !== "MESTRE" &&
      t.status === "ACTIVE" && {
        key: "reset-password",
        label: "Redefinir senha",
        ariaLabel: `Redefinir senha de ${t.user.name}`,
        icon: KeyRound,
        onSelect: () => setResetting(t),
      },
    isMestre &&
      t.role !== "MESTRE" &&
      t.status === "ACTIVE" &&
      !!t.user.twoFactorEnabled && {
        key: "reset-2fa",
        label: "Redefinir 2FA",
        ariaLabel: `Redefinir 2FA de ${t.user.name}`,
        icon: ShieldOff,
        onSelect: () => setResetting2fa(t),
      },
    canDelete &&
      t.status === "ACTIVE" && { key: "deactivate", label: "Inativar", icon: UserX, destructive: true, onSelect: () => setDeleting(t) },
  ];

  const table = (
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
        lp.filters.groupRoleId || lp.filters.status ? "Nenhum membro da equipe com esses filtros." : "Nenhum membro da equipe cadastrado ainda."
      }
      toolbar={
        <div className="flex flex-wrap gap-2">
          <NativeSelect
            aria-label="Filtrar por cargo"
            className="w-44"
            value={lp.filters.groupRoleId}
            onChange={(e) => lp.setFilter("groupRoleId", e.target.value)}
          >
            <option value="">Todos os cargos</option>
            {groupRoles.map((role) => (
              <option key={role.id} value={String(role.id)}>
                {role.active ? role.name : `${role.name} (inativo)`}
              </option>
            ))}
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
      rowActions={canEdit || canDelete ? (t) => <RowActions actions={teacherActions(t)} subject={t.user.name} /> : undefined}
    />
  );

  return (
    <>
      <PageHeader
        title="Equipe"
        description="A equipe do grupo. Todo mundo é aluno: os cargos se somam, o de maior rank é o selo principal e define o acesso ao painel."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Novo membro
            </Button>
          ) : undefined
        }
      />
      {isMestre ? (
        <Tabs defaultValue="equipe">
          <TabsList>
            <TabsTrigger value="equipe">Equipe</TabsTrigger>
            <TabsTrigger value="sugestoes">Sugestões de promoção</TabsTrigger>
            <TabsTrigger value="cargos">Cargos do grupo</TabsTrigger>
          </TabsList>
          <TabsContent value="equipe" className="mt-4">
            {table}
          </TabsContent>
          <TabsContent value="sugestoes" className="mt-4">
            <SugestoesPromocao />
          </TabsContent>
          <TabsContent value="cargos" className="mt-4">
            <CargosGrupo />
          </TabsContent>
        </Tabs>
      ) : (
        table
      )}

      <FormDialog<TeacherFormValues>
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isNew ? "Novo membro da equipe" : "Editar membro da equipe"}
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
            <ImageUploadField<TeacherFormValues>
              name="photo"
              label="Foto (URL)"
              shape="square"
              previewAlt="Foto do membro da equipe"
              description="Opcional. Envie uma foto (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem."
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
                  <FormLabel>Perfil de acesso</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {[...STAFF_ROLES].reverse().map((role) => (
                        <option key={role} value={role}>
                          {STAFF_ROLE_LABEL[role]}
                        </option>
                      ))}
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

      <PromoverDialog target={promoting} onClose={() => setPromoting(null)} />
      <RevogarDialog target={revoking} onClose={() => setRevoking(null)} />

      <ResetPasswordDialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        title="Redefinir senha do membro da equipe"
        description={
          resetting
            ? `Defina uma senha provisória para ${resetting.user.name}. As sessões abertas dele serão encerradas e ele deverá trocar a senha no próximo acesso.`
            : undefined
        }
        onSubmit={(newPassword) => resetPassword.mutateAsync({ id: resetting!.id, newPassword })}
      />

      <ResetTwoFactorDialog
        target={resetting2fa ? { userId: resetting2fa.user.id, name: resetting2fa.user.name } : null}
        onClose={() => setResetting2fa(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Inativar membro da equipe?"
        description={deleting ? `"${deleting.user.name}" será marcado como inativo. O histórico é preservado.` : undefined}
        confirmLabel="Inativar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
