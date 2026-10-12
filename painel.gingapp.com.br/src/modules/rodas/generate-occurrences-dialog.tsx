import { z } from "zod";
import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { DEFAULT_OCCURRENCES, MAX_OCCURRENCES, type Roda } from "./types";

/** Quantidade de ocorrências futuras a manter abertas: inteiro de 1 a 12 (o mesmo limite do backend). */
const occurrencesSchema = z.object({
  count: z
    .string()
    .trim()
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= MAX_OCCURRENCES,
      `Informe um número inteiro de 1 a ${String(MAX_OCCURRENCES)}.`,
    ),
});
type OccurrencesValues = z.infer<typeof occurrencesSchema>;

/**
 * "Gerar próximas ocorrências" de uma roda recorrente: escolhe QUANTAS ocorrências futuras manter abertas (1 a 12;
 * padrão 3). Repetir não duplica — o servidor só cria as que faltam.
 */
export function GenerateOccurrencesDialog({
  roda,
  onClose,
  onGenerate,
}: {
  roda: Roda | null;
  onClose: () => void;
  onGenerate: (rodaId: number, count: number) => Promise<unknown>;
}) {
  return (
    <FormDialog<OccurrencesValues>
      open={roda !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Gerar próximas ocorrências"
      description={
        roda
          ? `${roda.title}: mantém abertas as próximas ocorrências da série. Repetir não duplica; só as que faltam são criadas.`
          : undefined
      }
      schema={occurrencesSchema}
      defaultValues={{ count: String(DEFAULT_OCCURRENCES) }}
      submitLabel="Gerar"
      onSubmit={(values) => onGenerate(roda!.id, Number(values.count))}
    >
      {(form) => (
        <FormField
          control={form.control}
          name="count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quantidade de ocorrências</FormLabel>
              <FormControl>
                <Input type="number" inputMode="numeric" min={1} max={MAX_OCCURRENCES} step={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </FormDialog>
  );
}
