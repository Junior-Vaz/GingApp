import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { lessons } from "@/modules/aulas/aulas-api";

/** Maior período aceito por POST /classes/:id/generate-lessons (to - from, em dias). */
export const MAX_GENERATE_DAYS = 90;

const DAY_MS = 86_400_000;
const parseDay = (value: string) => Date.parse(`${value}T00:00:00Z`);

/** Dias entre duas datas "YYYY-MM-DD" (UTC, sem efeito de fuso/horário de verão). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

export const generateLessonsSchema = z
  .object({
    from: z.string().min(1, "Informe a data inicial."),
    to: z.string().min(1, "Informe a data final."),
  })
  .superRefine((v, ctx) => {
    if (!v.from || !v.to) return;
    const days = daysBetween(v.from, v.to);
    if (Number.isNaN(days)) return;
    if (days < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "A data final deve ser igual ou depois da inicial." });
    } else if (days > MAX_GENERATE_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: `O período não pode passar de ${MAX_GENERATE_DAYS} dias.` });
    }
  });
export type GenerateLessonsValues = z.infer<typeof generateLessonsSchema>;

/** Resposta de POST /classes/:id/generate-lessons. */
export interface GenerateLessonsResult {
  classId: number;
  from: string;
  to: string;
  occurrences: number;
  created: number;
  ignored: number;
  createdDates: string[];
  ignoredDates: string[];
}

/** Texto do toast de sucesso: "4 aulas criadas, 2 já existiam." */
export function generateLessonsMessage(r: Pick<GenerateLessonsResult, "created" | "ignored" | "occurrences">): string {
  if (r.occurrences === 0) return "Nenhuma data do período cai no dia da semana da turma.";
  const created = r.created === 1 ? "1 aula criada" : `${r.created} aulas criadas`;
  if (r.ignored === 0) return `${created}.`;
  const ignored = r.ignored === 1 ? "1 já existia" : `${r.ignored} já existiam`;
  return `${created}, ${ignored}.`;
}

/** POST /classes/:id/generate-lessons {from,to} (idempotente). Invalida as listas de aulas e avisa por toast. */
export function useGenerateLessons(classId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: GenerateLessonsValues) =>
      api.post<GenerateLessonsResult>(`/classes/${String(classId)}/generate-lessons`, {
        from: values.from,
        to: values.to,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
      toast.success(generateLessonsMessage(result));
    },
    onError: (error) => notifyError(error, "Não foi possível gerar as aulas."),
  });
}
