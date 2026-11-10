import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import { LESSON_COUNTS_KEY, lessons, type Lesson } from "@/modules/aulas/aulas-api";
import { lessonsSyncMessage, type ClassLessonsSync } from "./lessons-sync";
import type { ClassInput, ClassItem } from "./schema";

export type { ClassLessonsSync } from "./lessons-sync";

/** CRUD de turmas (GET/POST/PATCH). Apagar de verdade é `useDeleteClass`; inativar é `useInactivateClass` (PATCH status). */
export const classes = createCrud<ClassItem, ClassInput>("/classes", {
  created: "Turma criada.",
  updated: "Turma atualizada.",
});

/** Impacto de apagar a turma (GET /classes/:id/delete-impact, só Mestre). */
export interface ClassDeleteImpact {
  class: { id: number; name: string };
  lessons: number;
  attendances: number;
  students: number;
}

/** Busca o impacto enquanto o diálogo de apagar está aberto (`classId` indefinido = desligado). */
export function useClassDeleteImpact(classId: number | undefined) {
  return useQuery({
    queryKey: ["classes", "delete-impact", classId],
    queryFn: () => api.get<ClassDeleteImpact>(`/classes/${String(classId)}/delete-impact`),
    enabled: classId !== undefined,
    gcTime: 0, // sempre a contagem de agora: nunca reaproveita um impacto antigo
  });
}

/** Tudo o que depende de turma/aula/presença: lista de turmas, detalhe, alunos, aulas, contagens, frequência. */
function useInvalidateClassData() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: classes.rootKey });
    void queryClient.invalidateQueries({ queryKey: ["classes"] });
    void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
    void queryClient.invalidateQueries({ queryKey: LESSON_COUNTS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["aulas"] });
    void queryClient.invalidateQueries({ queryKey: ["frequencia"] });
  };
}

/** Resposta do PATCH /classes/:id: o `ClassView` de sempre + `lessonsSync` SÓ quando a troca de dia foi aplicada. */
export type ClassUpdateResult = ClassItem & { lessonsSync?: ClassLessonsSync };

/**
 * Editar turma (PATCH /classes/:id, `{ id, data }`). Mesmo comportamento do `classes.useUpdate()` (toast "Turma atualizada.",
 * toast de erro), mais: invalida também aulas/contagens/"Próxima aula" (a edição pode ter movido aulas) e, se a resposta
 * trouxer `lessonsSync` (troca do dia da semana), mostra o resumo do que aconteceu com as aulas.
 */
export function useUpdateClass() {
  const invalidate = useInvalidateClassData();
  return useMutation<ClassUpdateResult, Error, { id: number; data: Partial<ClassInput> }>({
    mutationFn: ({ id, data }) => api.patch<ClassUpdateResult>(`/classes/${String(id)}`, data),
    onSuccess: (result) => {
      invalidate();
      toast.success("Turma atualizada.");
      if (result?.lessonsSync) toast.success(lessonsSyncMessage(result.lessonsSync));
    },
    onError: (error) => notifyError(error),
  });
}

/** Inativar = PATCH { status: "INACTIVE" } (a turma e o histórico continuam). */
export function useInactivateClass() {
  const invalidate = useInvalidateClassData();
  return useMutation({
    mutationFn: (id: number) => api.patch<ClassItem>(`/classes/${String(id)}`, { status: "INACTIVE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Turma inativada.");
    },
    onError: (error) => notifyError(error, "Não foi possível inativar a turma."),
  });
}

/**
 * Apaga a turma de verdade (DELETE /classes/:id). Com aulas ou presenças o backend exige `?confirm=true`; o diálogo forte
 * já mostrou o impacto, então `confirm` vai quando há algo a perder (sem aulas/presenças o servidor nem pede).
 */
export function useDeleteClass() {
  const invalidate = useInvalidateClassData();
  return useMutation({
    mutationFn: ({ id, confirm }: { id: number; confirm: boolean }) =>
      api.delete<unknown>(`/classes/${String(id)}${confirm ? "?confirm=true" : ""}`),
    onSuccess: () => {
      invalidate();
      toast.success("Turma apagada.");
    },
    onError: (error) => notifyError(error, "Não foi possível apagar a turma."),
  });
}

/** Próximas aulas da turma (de `today` em diante, qualquer status, as 8 mais próximas) para o detalhe da turma. */
export function useClassUpcomingLessons(classId: number, today: string) {
  return useQuery({
    queryKey: ["classes", "upcoming-lessons", classId, today],
    queryFn: () => api.getPage<Lesson>("/lessons", { classId, from: today, order: "asc", limit: 8 }),
  });
}