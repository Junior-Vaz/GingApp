import { addDays, format } from "date-fns";
import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  MAX_GENERATE_DAYS,
  generateLessonsSchema,
  useGenerateLessons,
  type GenerateLessonsValues,
} from "./generate-lessons";
import { WEEKDAY_LABEL, scheduleLabel, type ClassItem } from "./schema";

/** Período padrão: de hoje a 4 semanas (data local do navegador). */
function defaultPeriod(): GenerateLessonsValues {
  const today = new Date();
  return { from: format(today, "yyyy-MM-dd"), to: format(addDays(today, 28), "yyyy-MM-dd") };
}

/**
 * "Gerar aulas" de uma turma: escolhe o período e cria uma aula por ocorrência do dia da semana da
 * turma (horário e professor copiados). Repetir não duplica — datas que já têm aula são ignoradas.
 */
export function GenerateLessonsDialog({ turma, onClose }: { turma: ClassItem | null; onClose: () => void }) {
  const generate = useGenerateLessons(turma?.id);
  const weekday = turma?.weekday != null ? (WEEKDAY_LABEL[turma.weekday] ?? "") : "";

  return (
    <FormDialog<GenerateLessonsValues>
      open={turma !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Gerar aulas"
      description={
        turma
          ? `${turma.name}: uma aula para cada ${weekday.toLowerCase()} do período (${scheduleLabel(turma)}), com o professor da turma. Datas que já têm aula são ignoradas. Máximo de ${MAX_GENERATE_DAYS} dias.`
          : undefined
      }
      schema={generateLessonsSchema}
      defaultValues={defaultPeriod()}
      submitLabel="Gerar aulas"
      onSubmit={(values) => generate.mutateAsync(values)}
    >
      {(form) => (
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="from"
            render={({ field }) => (
              <FormItem>
                <FormLabel>De</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="to"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Até</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </FormDialog>
  );
}
