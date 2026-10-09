import { z } from "zod";
import {
  fromLocalInput,
  idToField,
  isHttpUrl,
  optionalId,
  optionalText,
  toLocalInput,
} from "@/modules/rodas/form-utils";
import { EVENT_TYPES, type EventItem, type EventPayload } from "./types";

export const eventSchema = z.object({
  title: z.string().trim().min(2, "Informe o título do evento (mínimo 2 caracteres)."),
  date: z.string().min(1, "Informe a data do evento."),
  type: z.string().refine((value) => EVENT_TYPES.includes(value), "Escolha o tipo."),
  description: z.string(),
  location: z.string(),
  unitId: z.string(),
  isPublic: z.boolean(),
  stateId: z.string(),
  cityId: z.string(),
  imageUrl: z
    .string()
    .trim()
    .refine((value) => value === "" || isHttpUrl(value), "Informe uma URL válida (http/https)."),
});

export type EventFormValues = z.infer<typeof eventSchema>;

export const emptyEvent: EventFormValues = {
  title: "",
  date: "",
  type: "OUTRO",
  description: "",
  location: "",
  unitId: "",
  isPublic: false,
  stateId: "",
  cityId: "",
  imageUrl: "",
};

export function eventToForm(event: EventItem): EventFormValues {
  return {
    title: event.title,
    date: toLocalInput(event.date),
    type: event.type,
    description: event.description ?? "",
    location: event.location ?? "",
    unitId: idToField(event.unitId),
    isPublic: event.isPublic,
    stateId: idToField(event.stateId),
    cityId: idToField(event.cityId),
    imageUrl: event.imageUrl ?? "",
  };
}

/** Valores do formulário -> corpo do POST/PATCH. No PATCH, texto vazio é enviado para limpar o campo. */
export function buildEventPayload(values: EventFormValues, isEdit: boolean): EventPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    type: values.type,
    description: isEdit ? values.description : optionalText(values.description),
    location: isEdit ? values.location.trim() : optionalText(values.location),
    unitId: optionalId(values.unitId),
    isPublic: values.isPublic,
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
  };
}
