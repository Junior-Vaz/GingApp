import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";

export interface GraduationLevel {
  id: number;
  graduationSystemId: number;
  name: string;
  order: number;
  color: string | null;
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
  order: number;
  color?: string | undefined;
}

export interface RegistrationInput {
  graduationLevelId: number;
  graduatedAt: string;
  notes?: string | undefined;
}

export interface LevelUpdate {
  name?: string;
  order?: number;
  color?: string | null;
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

/** Níveis de todos os sistemas ATIVOS num só select, rotulados "Sistema — Nível". */
export function levelOptions(list: GraduationSystem[] | undefined) {
  const options: { id: number; label: string; color: string | null }[] = [];
  for (const system of list ?? []) {
    if (!system.isActive) continue;
    for (const level of [...system.levels].sort((a, b) => a.order - b.order)) {
      options.push({ id: level.id, label: `${system.name} — ${level.name}`, color: level.color });
    }
  }
  return options;
}
