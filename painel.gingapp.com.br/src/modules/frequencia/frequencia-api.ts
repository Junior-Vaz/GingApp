import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Page } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import type { ClassOption, Lesson } from "@/modules/aulas/aulas-api";
import { buildPayload, type AttendancePayloadEntry, type RosterEntry, type RosterRow } from "./roster";

/** Teto de itens por chamada do backend (`limit` 1..200). */
export const SELECTOR_LIMIT = 200;

export interface LessonFilters {
  classId: string;
  from: string;
  to: string;
}

/**
 * Aulas ATIVAS para o seletor da chamada (GET /lessons?status=ACTIVE&limit=200[&classId&from&to]).
 * Filtros no servidor: sem eles, só as 200 aulas mais recentes (por id) chegam; com turma/período
 * o usuário alcança aulas antigas. `total` vem do header X-Total-Count.
 */
export function useLessonSelector(filters: LessonFilters) {
  const params = {
    status: "ACTIVE",
    classId: filters.classId,
    from: filters.from,
    to: filters.to,
    limit: SELECTOR_LIMIT,
  };
  return useQuery<Page<Lesson>>({
    queryKey: ["frequencia", "lessons", params],
    queryFn: () => api.getPage<Lesson>("/lessons", params),
    placeholderData: keepPreviousData,
  });
}

/** Turmas para o filtro (GET /classes?limit=200). */
export function useClassSelector() {
  return useQuery<Page<ClassOption>>({
    queryKey: ["frequencia", "classes", SELECTOR_LIMIT],
    queryFn: () => api.getPage<ClassOption>("/classes", { limit: SELECTOR_LIMIT }),
  });
}

/** Chave da chamada de uma aula (GET /attendance/lessons/:id). */
export const rosterKey = (lessonId: string) => ["frequencia", "roster", lessonId];

/** Chamada da aula: alunos matriculados com a marcação atual (`present: null` = ainda sem chamada). `lessonId` vazio = desligado. */
export function useRoster(lessonId: string) {
  return useQuery({
    queryKey: rosterKey(lessonId),
    queryFn: () => api.get<RosterEntry[]>(`/attendance/lessons/${lessonId}`),
    enabled: lessonId !== "",
  });
}

/**
 * Salva a chamada em lote (POST /attendance/lessons/:id com `buildPayload(rows)`: só quem tem decisão). Compartilhada
 * pela página de Frequência e pela chamada rápida (botão flutuante). Invalida a chamada e as sessões de hoje.
 */
export function useSaveAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, rows }: { lessonId: string; rows: RosterRow[] }) =>
      api.post<{ count: number }>(`/attendance/lessons/${lessonId}`, buildPayload(rows) satisfies AttendancePayloadEntry[]),
    onSuccess: (result, { lessonId, rows }) => {
      toast.success(`Frequência salva (${result?.count ?? buildPayload(rows).length} alunos).`);
      void queryClient.invalidateQueries({ queryKey: rosterKey(lessonId) });
      void queryClient.invalidateQueries({ queryKey: QUICK_SESSIONS_KEY });
    },
    onError: (error) => notifyError(error, "Não foi possível salvar a frequência."),
  });
}

/** Aula de hoje na chamada rápida (GET /attendance/quick-sessions). */
export interface QuickSession {
  lessonId: number;
  classId: number;
  className: string;
  classPhoto: string | null;
  startTime: string | null;
  endTime: string | null;
  unitName: string | null;
  status: "UPCOMING" | "ONGOING" | "ENDED";
  studentsCount: number;
  markedCount: number;
}

export const QUICK_SESSIONS_KEY = ["frequencia", "quick-sessions"];

/** Aulas de hoje (em andamento/próxima primeiro). Atualiza a cada minuto para o status da aula mudar sozinho. */
export function useQuickSessions(enabled: boolean) {
  return useQuery({
    queryKey: QUICK_SESSIONS_KEY,
    queryFn: () => api.get<QuickSession[]>("/attendance/quick-sessions"),
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}
