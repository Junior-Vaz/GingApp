import { plural } from "@/lib/plural";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Page } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { currentLessonWindow } from "@/lib/lesson-window";
import { lessons as lessonsCrud, type ClassOption, type Lesson } from "@/modules/aulas/aulas-api";
import { ORG_KEY, fetchOwnOrganization } from "@/modules/configuracoes/org-api";
import { buildPayload, type AttendancePayloadEntry, type RosterEntry, type RosterRow } from "./roster";

/** Teto de itens por chamada do backend (`limit` 1..200). */
export const SELECTOR_LIMIT = 200;

/** Limite do seletor na janela padrão (hoje-7 a hoje+30): poucas aulas, as mais próximas primeiro. */
export const WINDOW_SELECTOR_LIMIT = 60;

export interface LessonFilters {
  classId: string;
  from: string;
  to: string;
  /** "Mostrar todas": sem a janela padrão (ainda respeita turma e datas escolhidas). */
  showAll?: boolean;
}

/**
 * Params de GET /lessons do seletor. Sem datas escolhidas e sem "mostrar todas", usa a janela padrão
 * (from = hoje-7 dias, to = hoje+30 dias, limit 60); senão, limit 200 com as datas do usuário.
 * Sempre `order=nearest`: hoje e futuras (crescente) primeiro, depois as passadas da mais recente à mais antiga.
 */
export function lessonSelectorParams(filters: LessonFilters, today: Date = new Date()) {
  const windowed = !filters.showAll && !filters.from && !filters.to;
  const range = windowed ? currentLessonWindow(today) : { from: filters.from, to: filters.to };
  return {
    status: "ACTIVE",
    classId: filters.classId,
    from: range.from,
    to: range.to,
    order: "nearest",
    limit: windowed ? WINDOW_SELECTOR_LIMIT : SELECTOR_LIMIT,
  };
}

/**
 * Aulas ATIVAS para o seletor da chamada (GET /lessons?status=ACTIVE&order=nearest&limit&from&to[&classId]).
 * Padrão: janela hoje-7..hoje+30 (limit 60); turma/período/"mostrar todas" alcançam aulas antigas (limit 200).
 * `total` vem do header X-Total-Count.
 */
export function useLessonSelector(filters: LessonFilters) {
  const params = lessonSelectorParams(filters);
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
    onSuccess: async (result, { lessonId, rows }) => {
      void queryClient.invalidateQueries({ queryKey: rosterKey(lessonId) });
      void queryClient.invalidateQueries({ queryKey: QUICK_SESSIONS_KEY });
      // Preferência do grupo "avisar quando a presença for registrada": lida só aqui (cache de 5 min), sem peso extra
      // na tela. Qualquer falha ao ler cai no toast padrão.
      let notifies = false;
      try {
        const org = await queryClient.fetchQuery({ queryKey: ORG_KEY, queryFn: fetchOwnOrganization, staleTime: 5 * 60_000 });
        notifies = org?.attendanceNotifications === true;
      } catch {
        notifies = false;
      }
      toast.success(
        notifies
          ? "Chamada salva — presentes foram avisados"
          : `Frequência salva (${plural(result?.count ?? buildPayload(rows).length, "aluno")}).`,
      );
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
  /** true = a aula de hoje está CANCELADA (vem depois das ativas; não marca presença). Ausente = aula ativa. */
  cancelled?: boolean;
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

/**
 * Reativa uma aula cancelada (PATCH /lessons/:id { status: "ACTIVE" }, `lessons:edit`). O backend limpa o cancelamento e
 * avisa os alunos da turma ("Aula reativada") como em qualquer reativação. Atualiza as aulas de hoje e a tela Aulas.
 */
export function useReactivateLesson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: number) => api.patch<Lesson>(`/lessons/${lessonId}`, { status: "ACTIVE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUICK_SESSIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: lessonsCrud.rootKey });
      toast.success("Aula reativada.");
    },
    onError: (error) => notifyError(error, "Não foi possível reativar a aula."),
  });
}
