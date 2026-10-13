import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import type { RopeStyle } from "@/lib/rope";
import type { AccessRole, RoleBadgeData } from "@/lib/staff-roles";
import { roleErrorMessage, SUGGESTIONS_KEY, type RoleLevel } from "@/modules/professores/roles-api";

export type { RopeStyle } from "@/lib/rope";

export interface GraduationLevel {
  id: number;
  graduationSystemId: number;
  name: string;
  order: number;
  /** Cor primária (legado/atalho); o desenho da corda usa `style` + `colors`. */
  color: string | null;
  style?: RopeStyle | undefined;
  /** 1 cor (SOLID) ou 2-3 cores (SPLIT/BRAIDED). */
  colors?: string[] | undefined;
  /** Corda com pontas: cor (#RRGGBB) da ponta de cima/primeira; null/ausente = sem ponta (o corpo é style + colors). */
  tipStart?: string | null | undefined;
  /** Corda com pontas: cor (#RRGGBB) da ponta de baixo/última; null/ausente = sem ponta. */
  tipEnd?: string | null | undefined;
  /** Alunos cuja graduação atual é este nível (quando o servidor informa). */
  studentCount?: number | null | undefined;
}

export interface GraduationSystem {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  levels: GraduationLevel[];
}

export interface StudentGraduation {
  id: number;
  studentId: number;
  graduationLevelId: number;
  graduatedAt: string;
  notes: string | null;
  graduationLevel: GraduationLevel;
}

export interface SystemInput {
  name: string;
  /** `null` limpa a descrição (só no PATCH). */
  description?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface LevelInput {
  name: string;
  order?: number | undefined;
  style: RopeStyle;
  colors: string[];
  /** 
ull = sem ponta (a corda sem pontas envia as duas como null). */
  tipStart: string | null;
  tipEnd: string | null;
}

export interface RegistrationInput {
  graduationLevelId: number;
  graduatedAt: string;
  notes?: string | undefined;
}

export interface LevelUpdate {
  name?: string;
  order?: number;
  style?: RopeStyle;
  colors?: string[];
  /** 
ull limpa a ponta (PATCH). */
  tipStart?: string | null;
  tipEnd?: string | null;
}

export interface GraduationTemplate {
  code: string;
  name: string;
  description: string;
  levels: { name: string; style: RopeStyle; colors: string[]; tipStart?: string | null; tipEnd?: string | null }[];
}

export interface RegistrationUpdate {
  graduationLevelId?: number;
  graduatedAt?: string;
  notes?: string | null;
}

/** GET/POST/PATCH /graduations/systems (a remoção tem hook próprio: o backend inativa ou apaga). */
export const systems = createCrud<GraduationSystem, SystemInput>("/graduations/systems", {
  created: "Sistema de graduação criado.",
  updated: "Sistema de graduação atualizado.",
});

/** DELETE /graduations/systems/:id — com graduações concedidas o backend só inativa (isActive=false). */
export function useRemoveSystem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.delete<{ id: number; deleted?: boolean; isActive?: boolean }>(`/graduations/systems/${id}`),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success(result?.deleted ? "Sistema removido." : "Sistema inativado. O histórico dos alunos foi preservado.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover o sistema."),
  });
}

export function useUpdateLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: LevelUpdate }) =>
      api.patch<GraduationLevel>(`/graduations/levels/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Nível atualizado.");
    },
    onError: (error) => notifyError(error, "Não foi possível atualizar o nível."),
  });
}

export function useRemoveLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/graduations/levels/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Nível removido.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover o nível."),
  });
}

export function useCreateLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ systemId, data }: { systemId: number; data: LevelInput }) =>
      api.post<GraduationLevel>(`/graduations/systems/${systemId}/levels`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Nível adicionado.");
    },
    onError: (error) => notifyError(error, "Não foi possível adicionar o nível."),
  });
}

/** POST /graduations/levels/:id/duplicate */
export function useDuplicateLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<GraduationLevel>(`/graduations/levels/${id}/duplicate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Nível duplicado.");
    },
    onError: (error) => notifyError(error, "Não foi possível duplicar o nível."),
  });
}

/** PUT /graduations/systems/:id/levels/reorder — `order` = ids dos níveis na nova sequência. */
export function useReorderLevels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ systemId, order }: { systemId: number; order: number[] }) =>
      api.put(`/graduations/systems/${systemId}/levels/reorder`, { order }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Ordem dos níveis atualizada.");
    },
    onError: (error) => notifyError(error, "Não foi possível reordenar os níveis."),
  });
}

/** GET /graduations/templates — modelos prontos de sistema (cordas de capoeira etc.). */
export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ["graduacoes", "templates"],
    queryFn: () => api.get<GraduationTemplate[]>("/graduations/templates"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** POST /graduations/systems/from-template */
export function useCreateFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { code: string; name?: string | undefined }) =>
      api.post<GraduationSystem>("/graduations/systems/from-template", data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systems.rootKey });
      toast.success("Sistema criado a partir do modelo.");
    },
    onError: (error) => notifyError(error, "Não foi possível criar o sistema a partir do modelo."),
  });
}

const historyKey = (studentId: number | undefined) => ["graduacoes", "history", studentId];

export function useStudentHistory(studentId: number | undefined) {
  return useQuery({
    queryKey: historyKey(studentId),
    queryFn: () => api.get<StudentGraduation[]>(`/graduations/students/${studentId}`),
    enabled: studentId !== undefined,
  });
}

export function useRegisterGraduation(studentId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RegistrationInput) =>
      api.post<StudentGraduation>(`/graduations/students/${studentId}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey(studentId) });
      toast.success("Graduação registrada.");
    },
    onError: (error) => notifyError(error, "Não foi possível registrar a graduação."),
  });
}

export function useUpdateGraduation(studentId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RegistrationUpdate }) =>
      api.patch<StudentGraduation>(`/graduations/students/${studentId}/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey(studentId) });
      toast.success("Graduação atualizada.");
    },
    onError: (error) => notifyError(error, "Não foi possível atualizar a graduação."),
  });
}

export function useRemoveGraduation(studentId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/graduations/students/${studentId}/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey(studentId) });
      toast.success("Graduação removida.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover a graduação."),
  });
}

export interface LevelOption {
  id: number;
  label: string;
  systemName: string;
  level: GraduationLevel;
}

/** Níveis de todos os sistemas ATIVOS numa só lista, rotulados "Sistema — Nível". */
export function levelOptions(list: GraduationSystem[] | undefined) {
  const options: LevelOption[] = [];
  for (const system of list ?? []) {
    if (!system.isActive) continue;
    for (const level of [...system.levels].sort((a, b) => a.order - b.order)) {
      options.push({ id: level.id, label: `${system.name} — ${level.name}`, systemName: system.name, level });
    }
  }
  return options;
}

/** Regra de um cargo do grupo: a partir de qual nível (`order`) do sistema ele é possível. */
export interface RoleRule {
  groupRoleId: number;
  groupRole: RoleBadgeData & { active: boolean };
  /** Perfil de acesso do cargo (legado). */
  role?: AccessRole;
  minLevelOrder: number;
  level: RoleLevel | null;
}

/** GET/PUT /graduations/systems/:id/role-rules. */
export interface RoleRules {
  systemId: number;
  rules: RoleRule[];
}

const roleRulesKey = (systemId: number) => ["graduacoes", "role-rules", systemId] as const;

/** GET: quem vê graduações lê as regras. Sem retry para o erro de permissão aparecer de imediato. */
export function useRoleRules(systemId: number, enabled = true) {
  return useQuery({
    queryKey: roleRulesKey(systemId),
    queryFn: () => api.get<RoleRules>(`/graduations/systems/${systemId}/role-rules`),
    enabled,
    retry: false,
  });
}

/** PUT: substitui as regras do sistema (só o Mestre). Atualiza também as sugestões de promoção. */
export function useSaveRoleRules(systemId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: { groupRoleId: number; minLevelOrder: number }[]) =>
      api.put<RoleRules>(`/graduations/systems/${systemId}/role-rules`, { rules }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roleRulesKey(systemId) });
      void queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
      toast.success("Regras de cargo por corda salvas.");
    },
    onError: (error) => toast.error(roleErrorMessage(error, "Não foi possível salvar as regras de cargo.")),
  });
}
