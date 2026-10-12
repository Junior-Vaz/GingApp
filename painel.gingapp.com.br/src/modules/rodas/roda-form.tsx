import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImageUrlField } from "./image-field";
import { LocationCoordinatesFields } from "./location-coordinates";
import { LocationFields } from "./location-fields";
import { NativeSelect } from "./native-select";
import {
  buildRodaPayload,
  buildRodaUpdatePayload,
  emptyRoda,
  rodaSchema,
  rodaToForm,
  type RodaFormValues,
} from "./roda-schema";
import { RECURRENCE_LABEL, RECURRENCES, type Roda, type RodaPayload } from "./types";

interface RodaFormProps {
  /** `null` = fechado, "new" = criação, Roda = edição. */
  editing: Roda | "new" | null;
  onClose: () => void;
  onSubmit: (payload: RodaPayload, id: number | null) => Promise<unknown>;
}

export function RodaForm({ editing, onClose, onSubmit }: RodaFormProps) {
  const roda = editing && editing !== "new" ? editing : null;
  const isOccurrence = Boolean(roda?.parentRodaId);
  return (
    <FormDialog<RodaFormValues>
      as="sheet"
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={roda ? "Editar roda" : "Nova roda"}
      schema={rodaSchema}
      defaultValues={roda ? rodaToForm(roda) : emptyRoda}
      onSubmit={(values) => roda ? onSubmit(buildRodaUpdatePayload(values, roda), roda.id) : onSubmit(buildRodaPayload(values), null)}
    >
      {(form) => (
        <>
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Título</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data e hora</FormLabel>
                <FormControl>
                  <Input type="datetime-local" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Local</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="recurrence"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Repetição</FormLabel>
                <FormControl>
                  <NativeSelect {...field} disabled={isOccurrence}>
                    {RECURRENCES.map((recurrence) => (
                      <option key={recurrence} value={recurrence}>
                        {RECURRENCE_LABEL[recurrence]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormControl>
                {isOccurrence && (
                  <FormDescription>Esta roda é uma ocorrência gerada; edite a repetição na roda de origem da série.</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          {form.watch("recurrence") !== "NONE" && (
            <FormField
              control={form.control}
              name="recurrenceUntil"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repetir até</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={isOccurrence} {...field} />
                  </FormControl>
                  <FormDescription>Último dia da série. A regra vem da data e hora da roda acima. Vazio = sem data final.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <LocationFields />
          <LocationCoordinatesFields />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Descrição</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <ImageUrlField />
        </>
      )}
    </FormDialog>
  );
}
