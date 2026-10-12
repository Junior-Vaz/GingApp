import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { lessons } from "@/modules/aulas/aulas-api";

/** Maior período aceito por POST /classes/:id/generate-lessons com `from`/`to` explícitos (to - from, em dias). */
export const MAX_GENERATE_DAYS = 90;

const DAY_MS = 86_400_000;
const parseDay = (value: string) => Date.parse(`${value}T00:00:00Z`);

/** Dias entre duas datas "YYYY-MM-DD" (UTC, sem efeito de fuso/horário de verão). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

/** "continuous" = geração contínua (sem data final); "period" = from/to explícitos (máx. 90 dias). */
export type GenerateMode = "continuous" | "period";

export const generateLessonsSchema = z
  .object({
    mode: z.enum(["continuous", "period"]),
    from: z.string(),
    to: z.string(),
  })
  .superRefine((v, ctx) => {
    // Contínuo não tem período: nada a validar (o servidor mantém ~60 dias à frente sozinho).
    if (v.mode === "continuous") return;
    if (!v.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"], message: "Informe a data inicial." });
    if (!v.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Informe a data final." });
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

/** Corpo do POST: contínuo envia só `from` (sem `to`); período envia `from` e `to`. */
export function generateLessonsBody(values: GenerateLessonsValues): { from: string; to?: string } {
  return values.mode === "continuous" ? { from: values.from } : { from: values.from, to: values.to };
}

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

/**
 * POST /classes/:id/generate-lessons (idempotente): `{from}` liga a geração CONTÍNUA (sem data final); `{from,to}` gera só
 * o período (até 90 dias). Invalida as listas de aulas e de turmas (selo "Aulas contínuas") e avisa por toast.
 */
export function useGenerateLessons(classId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: GenerateLessonsValues) =>
      api.post<GenerateLessonsResult>(`/classes/${String(classId)}/generate-lessons`, generateLessonsBody(values)),
    onSuccess: (result, values) => {
      void queryClient.invalidateQueries({ queryKey: lessons.rootKey });
      void queryClient.invalidateQueries({ queryKey: ["crud", "/classes"] });
      toast.success(
        values.mode === "continuous"
          ? `Aulas contínuas ligadas. ${generateLessonsMessage(result)}`
          : generateLessonsMessage(result),
      );
    },
    onError: (error) => notifyError(error, "Não foi possível gerar as aulas."),
  });
}
