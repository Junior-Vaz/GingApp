import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ImageUrlField } from "./image-field";
import { LocationFields } from "./location-fields";
import {
  buildRodaPayload,
  buildRodaUpdatePayload,
  emptyRoda,
  rodaSchema,
  rodaToForm,
  type RodaFormValues,
} from "./roda-schema";
import type { Roda, RodaPayload } from "./types";

interface RodaFormProps {
  /** `null` = fechado, "new" = criação, Roda = edição. */
  editing: Roda | "new" | null;
  onClose: () => void;
  onSubmit: (payload: RodaPayload, id: number | null) => Promise<unknown>;
}

export function RodaForm({ editing, onClose, onSubmit }: RodaFormProps) {
  const roda = editing && editing !== "new" ? editing : null;
  return (
    <FormDialog<RodaFormValues>
      as="sheet"
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={roda ? "Editar roda" : "Nova roda"}
      schema={rodaSchema}
      defaultValues={roda ? rodaToForm(roda) : emptyRoda}
      onSubmit={(values) => roda ? onSubmit(buildRodaUpdatePayload(values), roda.id) : onSubmit(buildRodaPayload(values), null)}
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
          <LocationFields />
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
