import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface StudentOption {
  id: number;
  name: string;
  status?: "ACTIVE" | "INACTIVE";
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
  description?: string | undefined;
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

/**
 * GET/POST /graduations/systems. O backend só expõe listar e criar (sem PATCH/DELETE de sistema
 * ou nível), então a UI também só lista e cria.
 */
export const systems = createCrud<GraduationSystem, SystemInput>("/graduations/systems", {
  created: "Sistema de graduação criado.",
});

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

/** Resultados por busca de aluno (backend aceita 1..200). */
export const STUDENT_SEARCH_LIMIT = 20;

/** Busca de alunos NO SERVIDOR: GET /students?q=&limit=20 (q vazio = os 20 mais recentes). */
export function useStudentSearch(q: string) {
  const params = { q, limit: STUDENT_SEARCH_LIMIT };
  return useQuery({
    queryKey: ["graduacoes", "students", params],
    queryFn: () => api.getPage<StudentOption>("/students", params),
    placeholderData: keepPreviousData,
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
