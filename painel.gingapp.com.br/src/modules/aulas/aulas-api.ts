import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type QueryParams } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import type { StaffRole } from "@/lib/staff-roles";

/** Aula. `date` chega como meia-noite UTC (use dayOnly de @/lib/format para exibir). */
export interface Lesson {
  id: number;
  classId: number;
  unitId: number | null;
  teacherUserId: number | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
  /** Turma/unidade/professor já resolvidos pelo servidor (nome + foto) para as listas; ausentes em respostas antigas. */
  class?: { id: number; name: string; photo?: string | null };
  unit?: { id: number; name: string; photo?: string | null } | null;
  teacher?: { id: number; name: string; photo?: string | null } | null;
}

export interface ClassOption {
  id: number;
  name: string;
  photo?: string | null;
  /** Professor responsável da turma (as aulas geradas dela herdam este professor). */
  teacherUserId?: number | null;
}

export interface TeacherMembership {
  id: number;
  role: StaffRole;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null; photo?: string | null };
}

/**
 * Corpo de POST/PATCH /lessons. Na edição, campos limpos vão como `null` (o backend limpa a coluna):
 * unitId, teacherUserId, startTime, endTime e notes. classId, date e status NUNCA vão `null` (400).
 * O painel ainda não tem campo de unidade na aula (unitId não é enviado).
 */
export interface LessonInput {
  classId: number;
  date: string;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  teacherUserId?: number | null | undefined;
  notes?: string | null | undefined;
  status?: Lesson["status"];
}

export const STATUS_LABEL: Record<Lesson["status"], string> = {
  ACTIVE: "Ativa",
  INACTIVE: "Cancelada",
};

/**
 * CRUD de aulas. ATENÇÃO: useRemove (DELETE /lessons/:id) agora APAGA DE VERDADE (só Mestre) e exige ?confirm=true com presenças:
 * use useDeleteLesson. Cancelar a aula = PATCH status INACTIVE (useCancelLesson).
 */
export const lessons = createCrud<Lesson, LessonInput>("/lessons", {
  created: "Aula criada.",
  updated: "Aula atualizada.",
  removed: "Aula apagada.",
});

/** Selects auxiliares vêm de listas paginadas: pedimos o máximo do servidor (200) e avisamos se passar. */
export const OPTIONS_LIMIT = 200;

/** Turmas para os selects (primeiras 200; `data.total` > 200 => lista parcial). */
export function useClassOptions() {
  return useQuery({
    queryKey: ["aulas", "classes"],
    queryFn: () => api.getPage<ClassOption>("/classes", { limit: OPTIONS_LIMIT }),
  });
}

/** Professores para os selects (primeiros 200; `data.total` > 200 => lista parcial). */
export function useTeacherOptions() {
  return useQuery({
    queryKey: ["aulas", "teachers"],
    queryFn: () => api.getPage<TeacherMembership>("/teachers", { limit: OPTIONS_LIMIT }),
  });
}

/** "2026-03-05T00:00:00.000Z" -> "2026-03-05" (valor de <input type="date">). */
export const isoDay = (iso: string): string => iso.slice(0, 10);

/** Rótulo de horário: "18:00 – 19:30", "18:00 – —" ou "—". */
export function timeRange(lesson: Pick<Lesson, "startTime" | "endTime">): string {
  if (!lesson.startTime && !lesson.endTime) return "—";
  return `${lesson.startTime || "—"} – ${lesson.endTime || "—"}`;
}

/** Filtro de status da tela Aulas: "ACTIVE" (padrão), "INACTIVE" (canceladas) ou "" (todas). */
export type LessonStatusFilter = "ACTIVE" | "INACTIVE" | "";

/** Chave do localStorage com a última escolha de status da tela Aulas. */
export const LESSON_STATUS_KEY = "painel:aulas:status";

/** Lê a escolha salva (padrão: Ativas, para as canceladas não esconderem as aulas reais). Nunca lança. */
export function readLessonStatusFilter(): LessonStatusFilter {
  try {
    const saved = localStorage.getItem(LESSON_STATUS_KEY);
    return saved === "INACTIVE" || saved === "" ? saved : "ACTIVE";
  } catch {
    return "ACTIVE";
  }
}

export function saveLessonStatusFilter(value: LessonStatusFilter): void {
  try {
    localStorage.setItem(LESSON_STATUS_KEY, value);
  } catch {
    // armazenamento indisponível: a escolha vale só nesta sessão da página
  }
}

export const LESSON_COUNTS_KEY = ["aulas", "counts"];

/**
 * Totais por status para o cabeçalho da lista ("N ativas · M canceladas"), com os MESMOS filtros da lista
 * (turma, período e busca; sem status): GET /lessons?status=…&limit=1 lê o total de X-Total-Count.
 */
export function useLessonCounts(filters: QueryParams) {
  const totalOf = (status: "ACTIVE" | "INACTIVE") =>
    api.getPage<Lesson>("/lessons", { ...filters, status, limit: 1 }).then((p) => p.total);
  return useQuery({
    queryKey: [...LESSON_COUNTS_KEY, filters],
    queryFn: async () => {
      const [active, cancelled] = await Promise.all([totalOf("ACTIVE"), totalOf("INACTIVE")]);
      return { active, cancelled };
    },
  });
}

/** Reativação em massa (POST /lessons/reactivate, `lessons:edit`): sem avisar os alunos (padrão do servidor). */
export function useReactivateLessons() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { classId?: number; from: string; to: string }) =>
      api.post<{ reactivated: number }>("/lessons/reactivate", body),
    onSuccess: ({ reactivated }) => {
      void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
      void queryClient.invalidateQueries({ queryKey: LESSON_COUNTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["frequencia"] });
      toast.success(reactivated === 1 ? "1 aula reativada." : `${reactivated} aulas reativadas.`);
    },
    onError: (error) => notifyError(error, "Não foi possível reativar as aulas."),
  });
}

/** Cancelar aula = PATCH /lessons/:id { status: "INACTIVE" } (a aula e o histórico continuam; avisa os alunos). */
export function useCancelLesson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.patch<Lesson>(`/lessons/${String(id)}`, { status: "INACTIVE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
      void queryClient.invalidateQueries({ queryKey: LESSON_COUNTS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["frequencia"] });
      toast.success("Aula cancelada.");
    },
    onError: (error) => notifyError(error, "Não foi possível cancelar a aula."),
  });
}

/** Tudo o que muda quando aulas/presenças são apagadas: lista de aulas, totais, frequência e as turmas (próxima aula). */
function useInvalidateAfterLessonDelete() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
    void queryClient.invalidateQueries({ queryKey: LESSON_COUNTS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["frequencia"] });
    void queryClient.invalidateQueries({ queryKey: ["classes"] });
    void queryClient.invalidateQueries({ queryKey: ["crud", "/classes"] });
  };
}

/** Quantas presenças seriam apagadas junto com a aula (GET /lessons/:id/delete-impact, só Mestre). */
export function useLessonDeleteImpact(lessonId: number | undefined) {
  return useQuery({
    queryKey: ["aulas", "delete-impact", lessonId],
    queryFn: () => api.get<{ attendances: number }>(`/lessons/${String(lessonId)}/delete-impact`),
    enabled: lessonId !== undefined,
    gcTime: 0,
  });
}

/** Apaga a aula de verdade (DELETE /lessons/:id; `confirm` = ?confirm=true, obrigatório se há presenças). */
export function useDeleteLesson() {
  const invalidate = useInvalidateAfterLessonDelete();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: boolean }) =>
      api.delete<unknown>(`/lessons/${String(id)}${confirm ? "?confirm=true" : ""}`),
    onSuccess: () => {
      invalidate();
      toast.success("Aula apagada.");
    },
    onError: (error) => notifyError(error, "Não foi possível apagar a aula."),
  });
}

/** Resultado de POST /lessons/bulk-delete. */
export interface BulkDeleteResult {
  lessons: number;
  attendances: number;
  skipped: number;
  deleted: boolean;
}

/** Quantas aulas canceladas (e presenças) seriam apagadas (dryRun), da turma ou de todas (`classId` indefinido). `enabled` = diálogo aberto. */
export function useCancelledDeleteImpact(classId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["aulas", "bulk-delete-impact", classId ?? "all"],
    queryFn: () =>
      api.post<BulkDeleteResult>("/lessons/bulk-delete", { onlyCancelled: true, dryRun: true, ...(classId !== undefined ? { classId } : {}) }),
    enabled,
    gcTime: 0,
  });
}

/** Apaga de verdade TODAS as aulas canceladas (da turma ou do grupo). `confirm: true` quando há presenças. */
export function useBulkDeleteCancelled() {
  const invalidate = useInvalidateAfterLessonDelete();
  return useMutation({
    mutationFn: (body: { classId?: number; confirm: boolean }) =>
      api.post<BulkDeleteResult>("/lessons/bulk-delete", { onlyCancelled: true, ...body }),
    onSuccess: ({ lessons: n }) => {
      invalidate();
      toast.success(n === 1 ? "1 aula cancelada apagada." : `${n} aulas canceladas apagadas.`);
    },
    onError: (error) => notifyError(error, "Não foi possível apagar as aulas canceladas."),
  });
}