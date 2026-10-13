import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { RopeStyle } from "@/lib/rope";
import { STAFF_ROLE_LABEL, type StaffRole } from "@/lib/staff-roles";

/** Nível de graduação como o backend o descreve nas rotas de cargos (a corda sai de `style` + `colors`). */
export interface RoleLevel {
  id: number;
  name: string;
  order: number;
  color?: string | null | undefined;
  style?: RopeStyle | null | undefined;
  colors?: string[] | null | undefined;
}

/** Item de GET /roles/suggestions (só o Mestre): quem atingiu a corda mínima de um cargo que ainda não tem. */
export interface RoleSuggestion {
  studentId: number;
  personId: number;
  name: string;
  photo: string | null;
  hasLogin: boolean;
  currentRoles: StaffRole[];
  role: StaffRole;
  level: RoleLevel;
  system: { id: number; name: string };
  graduatedAt: string;
}

/** Resposta de POST /roles/grant e /roles/revoke. */
export interface RoleView {
  studentId: number;
  userId: number;
  roles: StaffRole[];
  accessRole: string;
}

/** Quem recebe/perde o cargo: a matrícula de aluno (`studentId`) ou a pessoa (`personId`). */
export type RoleTarget = { studentId: number } | { personId: number };

export const SUGGESTIONS_KEY = ["roles", "suggestions"] as const;

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

/** Mensagem em português para os erros de negócio dos cargos; os demais usam a mensagem do servidor. */
export function roleErrorMessage(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): string {
  const code = errorCode(error);
  if (code && ROLE_ERROR_MESSAGE[code]) return ROLE_ERROR_MESSAGE[code];
  return errorMessage(error, fallback);
}

/** Atualiza tudo que mostra cargos: equipe, alunos, ficha, sugestões e a lista de professores dos selects. */
export function useRefreshRoles() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      ["crud", "/teachers"],
      ["crud", "/students"],
      ["student-ficha"],
      ["aulas", "teachers"],
      SUGGESTIONS_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

/** POST /roles/revoke: tira UM cargo; a matrícula de aluno é mantida. Erros viram toast. */
export function useRevokeRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: ({ target, role }: { target: RoleTarget; role: StaffRole; name: string }) =>
      api.post<RoleView>("/roles/revoke", { ...target, role }),
    onSuccess: (_view, { role, name }) => {
      refresh();
      toast.success(`Cargo de ${STAFF_ROLE_LABEL[role]} revogado de ${name}. A matrícula de aluno foi mantida.`);
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível revogar o cargo.")),
  });
}
