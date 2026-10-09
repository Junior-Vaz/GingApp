import { useQuery } from "@tanstack/react-query";
import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { ImageUrlField } from "@/modules/rodas/image-field";
import { LocationFields } from "@/modules/rodas/location-fields";
import { NativeSelect } from "@/modules/rodas/native-select";
import { buildEventPayload, emptyEvent, eventSchema, eventToForm, type EventFormValues } from "./event-schema";
import { EVENT_TYPE_LABEL, EVENT_TYPES, type EventItem, type EventPayload, type Unit } from "./types";

interface EventFormProps {
  /** `null` = fechado, "new" = criação, EventItem = edição. */
  editing: EventItem | "new" | null;
  onClose: () => void;
  onSubmit: (payload: EventPayload, id: number | null) => Promise<unknown>;
}

export function EventForm({ editing, onClose, onSubmit }: EventFormProps) {
  const event = editing && editing !== "new" ? editing : null;
  // GET /units: sem @CanAccess, escopo da organização. Falha não bloqueia o formulário.
  const units = useQuery({
    queryKey: ["eventos", "units"],
    queryFn: () => api.get<Unit[]>("/units"),
    enabled: editing !== null,
  });

  return (
    <FormDialog<EventFormValues>
      as="sheet"
      open={editing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={event ? "Editar evento" : "Novo evento"}
      schema={eventSchema}
      defaultValues={event ? eventToForm(event) : emptyEvent}
      onSubmit={(values) => onSubmit(buildEventPayload(values, event !== null), event?.id ?? null)}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {EVENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {EVENT_TYPE_LABEL[type]}
                        </option>
                      ))}
                    </NativeSelect>
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
          </div>
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
            name="unitId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Unidade</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Nenhuma</option>
                    {units.data?.map((unit) => (
                      <option key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </option>
                    ))}
                  </NativeSelect>
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
          <FormField
            control={form.control}
            name="isPublic"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <FormLabel>Evento público (aparece no calendário da comunidade)</FormLabel>
              </FormItem>
            )}
          />
        </>
      )}
    </FormDialog>
  );
}
