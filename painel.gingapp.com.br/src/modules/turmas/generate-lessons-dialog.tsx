import { addDays, format } from "date-fns";
import { Infinity as InfinityIcon } from "lucide-react";
import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  MAX_GENERATE_DAYS,
  generateLessonsSchema,
  useGenerateLessons,
  type GenerateLessonsValues,
} from "./generate-lessons";
import { CONTINUOUS_AHEAD_DAYS, WEEKDAY_LABEL, scheduleLabel, type ClassItem } from "./schema";

/** Padrão: contínuo (sem data final), começando hoje; o período específico já vem com hoje a +28 dias (data local). */
function defaultValues(): GenerateLessonsValues {
  const today = new Date();
  return { mode: "continuous", from: format(today, "yyyy-MM-dd"), to: format(addDays(today, 28), "yyyy-MM-dd") };
}

/**
 * "Gerar aulas" de uma turma. Padrão "Contínuo (sem data final)": o sistema mantém ~60 dias de aulas à frente sozinho.
 * Desligado ("Período específico"), cria uma aula por ocorrência do dia da semana entre De e Até (máx. 90 dias).
 * Repetir não duplica — datas que já têm aula são ignoradas.
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
          ? `${turma.name}: uma aula para cada ${weekday.toLowerCase()} (${scheduleLabel(turma)}), com o professor da turma. Datas que já têm aula são ignoradas.`
          : undefined
      }
      schema={generateLessonsSchema}
      defaultValues={defaultValues()}
      submitLabel="Gerar aulas"
      onSubmit={(values) => generate.mutateAsync(values)}
    >
      {(form) => {
        const continuous = form.watch("mode") === "continuous";
        return (
          <>
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <FormLabel className="flex items-center gap-2">
                      <InfinityIcon className="size-4" aria-hidden /> Contínuo (sem data final)
                    </FormLabel>
                    <FormControl>
                      <Switch
                        aria-label="Contínuo (sem data final)"
                        checked={field.value === "continuous"}
                        onCheckedChange={(on) => field.onChange(on ? "continuous" : "period")}
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    {continuous
                      ? `O sistema mantém ~${CONTINUOUS_AHEAD_DAYS} dias de aulas à frente automaticamente, sem você precisar gerar de novo.`
                      : `Período específico: cria só as aulas entre as duas datas (máximo de ${MAX_GENERATE_DAYS} dias).`}
                  </FormDescription>
                </FormItem>
              )}
            />
            {!continuous && (
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
          </>
        );
      }}
    </FormDialog>
  );
}
