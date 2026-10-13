import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { RopeStyle } from "@/lib/rope";
import type { AccessRole, RoleBadgeData } from "@/lib/staff-roles";

/** Nível de graduação como o backend o descreve nas rotas de cargos (a corda sai de `style` + `colors`). */
export interface RoleLevel {
  id: number;
  name: string;
  order: number;
  color?: string | null | undefined;
  style?: RopeStyle | null | undefined;
  colors?: string[] | null | undefined;
}

/** Cargo do grupo (GET /group-roles), do mais sênior (maior rank) para o menos. */
export interface GroupRole extends RoleBadgeData {
  /** Um dos 4 cargos padrão do grupo: não se exclui (só renomeia/inativa). */
  isDefault: boolean;
  active: boolean;
  /** Quantas pessoas exercem o cargo hoje. */
  peopleCount: number;
  createdAt?: string;
}

/** Corpo de POST /group-roles. */
export interface GroupRoleCreateInput {
  name: string;
  accessRole: AccessRole;
  rank?: number | undefined;
  color?: string | undefined;
  icon?: string | undefined;
  active?: boolean | undefined;
}

/** Corpo de PATCH /group-roles/:id (`null` limpa cor/ícone). */
export interface GroupRoleUpdateInput {
  name?: string | undefined;
  accessRole?: AccessRole | undefined;
  rank?: number | undefined;
  color?: string | null | undefined;
  icon?: string | null | undefined;
  active?: boolean | undefined;
}

/** Resposta de POST /group-roles/:id/migrate. */
export interface MigrateResult {
  moved: number;
  from: { id: number; name: string };
  to: { id: number; name: string };
}

/** Item de GET /roles/suggestions (só o Mestre): quem atingiu a corda mínima de um cargo que ainda não tem. */
export interface RoleSuggestion {
  studentId: number;
  personId: number;
  name: string;
  photo: string | null;
  hasLogin: boolean;
  currentRoles: RoleBadgeData[];
  /** O cargo sugerido. */
  role: RoleBadgeData;
  groupRoleId: number;
  accessRole: AccessRole;
  level: RoleLevel;
  system: { id: number; name: string };
  graduatedAt: string;
}

/** Resposta de POST /roles/grant e /roles/revoke. */
export interface RoleView {
  studentId: number;
  userId: number;
  roles: RoleBadgeData[];
  roleKeys?: string[];
  accessRole: string;
}

/** Quem recebe/perde o cargo: a matrícula de aluno (`studentId`) ou a pessoa (`personId`). */
export type RoleTarget = { studentId: number } | { personId: number };

export const SUGGESTIONS_KEY = ["roles", "suggestions"] as const;
export const GROUP_ROLES_KEY = ["group-roles"] as const;

/** GET /group-roles: cargos do grupo (qualquer um que leia alunos). Sem retry para o erro de permissão aparecer de imediato. */
export function useGroupRoles(enabled = true) {
  return useQuery({
    queryKey: GROUP_ROLES_KEY,
    queryFn: () => api.get<GroupRole[]>("/group-roles"),
    enabled,
    retry: false,
  });
}

/** GET /roles/suggestions: o sistema sugere, o Mestre confirma. Sem retry para o erro de permissão aparecer de imediato. */
export function useRoleSuggestions(enabled = true) {
  return useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => api.get<RoleSuggestion[]>("/roles/suggestions"),
    enabled,
    retry: false,
  });
}

/** Código de negócio do erro (`code` do corpo), quando existe. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const fromBody = error.body?.["code"];
  return error.code ?? (typeof fromBody === "string" ? fromBody : undefined);
}

export const isLoginRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && errorCode(error) === "LOGIN_REQUIRED";

/** Quantas pessoas estão no cargo, quando o 409 GROUP_ROLE_IN_USE traz `peopleCount` no corpo. */
export function errorPeopleCount(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const count = error.body?.["peopleCount"];
  return typeof count === "number" ? count : undefined;
}

const ROLE_ERROR_MESSAGE: Record<string, string> = {
  ROLE_TARGET_REQUIRED: "Escolha o aluno (ou a pessoa) que vai receber o cargo.",
  STUDENT_NOT_ACTIVE: "A matrícula do aluno precisa estar ativa para receber um cargo.",
  ROLE_ALREADY_ACTIVE: "Esta pessoa já tem este cargo no grupo.",
  ROLE_NOT_ACTIVE: "Esta pessoa não tem este cargo ativo.",
  LAST_MESTRE: "Este é o último Mestre do grupo. Promova outro Mestre antes de revogar este cargo.",
  LOGIN_REQUIRED: "Esta pessoa ainda não tem login. Informe um e-mail e uma senha provisória (ou envie um convite).",
  INVALID_LEVEL_ORDER: "O nível escolhido não pertence a este sistema de graduação.",
  DUPLICATE_ROLE_RULE: "Cada cargo só pode aparecer uma vez nas regras.",
};

/**
 * Mensagem em português para os erros de negócio dos cargos já conhecidos; os demais (inclusive os dos cargos do
 * grupo: GROUP_ROLE_NAME_TAKEN, GROUP_ROLE_LIMIT, GROUP_ROLE_IN_USE...) usam a `message` enviada pelo servidor.
 */
export function roleErrorMessage(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): string {
  const code = errorCode(error);
  if (code && ROLE_ERROR_MESSAGE[code]) return ROLE_ERROR_MESSAGE[code];
  return errorMessage(error, fallback);
}

/** Atualiza tudo que mostra cargos: equipe, alunos, ficha, sugestões, cargos do grupo e a lista de professores dos selects. */
export function useRefreshRoles() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      ["crud", "/teachers"],
      ["crud", "/students"],
      ["student-ficha"],
      ["aulas", "teachers"],
      SUGGESTIONS_KEY,
      GROUP_ROLES_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

/** POST /roles/revoke: tira UM cargo; a matrícula de aluno é mantida. Erros viram toast. */
export function useRevokeRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: ({ target, groupRoleId }: { target: RoleTarget; groupRoleId: number; roleName: string; name: string }) =>
      api.post<RoleView>("/roles/revoke", { ...target, groupRoleId }),
    onSuccess: (_view, { roleName, name }) => {
      refresh();
      toast.success(`Cargo de ${roleName} revogado de ${name}. A matrícula de aluno foi mantida.`);
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível revogar o cargo.")),
  });
}

/** POST /group-roles (só o Mestre). O erro NÃO vira toast aqui: o formulário decide (fica aberto). */
export function useCreateGroupRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: (input: GroupRoleCreateInput) => api.post<GroupRole>("/group-roles", input),
    onSuccess: (role) => {
      refresh();
      toast.success(`Cargo "${role.name}" criado.`);
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível criar o cargo.")),
  });
}

/** PATCH /group-roles/:id (só o Mestre). */
export function useUpdateGroupRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: GroupRoleUpdateInput }) =>
      api.patch<GroupRole>(`/group-roles/${id}`, data),
    onSuccess: (role) => {
      refresh();
      toast.success(`Cargo "${role.name}" atualizado.`);
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível atualizar o cargo.")),
  });
}

/**
 * DELETE /group-roles/:id (204). O erro fica para quem chama (o 409 GROUP_ROLE_IN_USE abre o fluxo de migrar/inativar).
 */
export function useDeleteGroupRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/group-roles/${id}`),
    onSuccess: () => refresh(),
  });
}

/** PUT /group-roles/reorder: `order` = TODOS os ids do grupo, do mais sênior ao menos. */
export function useReorderGroupRoles() {
  const queryClient = useQueryClient();
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: (order: number[]) => api.put<GroupRole[]>("/group-roles/reorder", { order }),
    onSuccess: (list) => {
      if (Array.isArray(list)) queryClient.setQueryData(GROUP_ROLES_KEY, list);
      refresh();
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível reordenar os cargos.")),
  });
}

/** POST /group-roles/:id/migrate: move quem exerce o cargo para outro (antes de excluir/inativar). */
export function useMigrateGroupRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: ({ id, targetGroupRoleId }: { id: number; targetGroupRoleId: number }) =>
      api.post<MigrateResult>(`/group-roles/${id}/migrate`, { targetGroupRoleId }),
    onSuccess: (result) => {
      refresh();
      toast.success(`${result.moved} pessoa(s) movida(s) de "${result.from.name}" para "${result.to.name}".`);
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível migrar as pessoas.")),
  });
}
