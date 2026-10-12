import { z } from "zod";
import {
  fromLocalInput,
  idToField,
  isImageRef,
  nullableId,
  nullableText,
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
    .refine((value) => value === "" || isImageRef(value), "Informe uma URL válida (http/https)."),
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

/** CRIAR (POST): campos opcionais vazios são omitidos. Para editar use `buildEventUpdatePayload`. */
export function buildEventPayload(values: EventFormValues): EventPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    type: values.type,
    description: optionalText(values.description),
    location: optionalText(values.location),
    unitId: optionalId(values.unitId),
    isPublic: values.isPublic,
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
  };
}

/**
 * EDITAR (PATCH): opcionais esvaziados vão como `null` (o backend limpa a coluna; imageUrl `""`
 * daria 400). title/date/type/isPublic são obrigatórios e nunca vão `null`.
 */
export function buildEventUpdatePayload(values: EventFormValues): EventPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    type: values.type,
    description: nullableText(values.description),
    location: nullableText(values.location),
    unitId: nullableId(values.unitId),
    isPublic: values.isPublic,
    stateId: nullableId(values.stateId),
    cityId: nullableId(values.cityId),
    imageUrl: nullableText(values.imageUrl),
  };
}