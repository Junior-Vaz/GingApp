import { z } from "zod";
import {
  coordinatesCreatePayload,
  coordinatesToForm,
  coordinatesUpdatePayload,
  hasHalfCoordinates,
  latitudeField,
  longitudeField,
} from "@/lib/map";
import {
  fromLocalInput,
  idToField,
  isImageRef,
  nullableId,
  nullableText,
  optionalId,
  optionalText,
  toLocalInput,
} from "./form-utils";
import { RECURRENCES, type Recurrence, type Roda, type RodaPayload } from "./types";

export const rodaSchema = z
  .object({
    title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
    date: z.string().min(1, "Informe a data e a hora."),
    description: z.string(),
    location: z.string(),
    latitude: latitudeField,
    longitude: longitudeField,
    stateId: z.string(),
    cityId: z.string(),
    imageUrl: z
      .string()
      .trim()
      .refine((value) => value === "" || isImageRef(value), "Informe uma URL válida (http/https)."),
    recurrence: z.string().refine((value) => (RECURRENCES as string[]).includes(value), "Escolha a repetição."),
    recurrenceUntil: z.string(),
  })
  .refine((values) => !hasHalfCoordinates(values), {
    path: ["longitude"],
    message: "Informe a latitude e a longitude juntas (ou deixe as duas vazias).",
  })
  .refine((values) => values.recurrence === "NONE" || !values.recurrenceUntil || !values.date || values.recurrenceUntil >= values.date.slice(0, 10), {
    path: ["recurrenceUntil"],
    message: "O fim da série não pode ser antes da data da roda.",
  });

export type RodaFormValues = z.infer<typeof rodaSchema>;

export const emptyRoda: RodaFormValues = {
  title: "",
  date: "",
  description: "",
  location: "",
  latitude: "",
  longitude: "",
  stateId: "",
  cityId: "",
  imageUrl: "",
  recurrence: "NONE",
  recurrenceUntil: "",
};

export function rodaToForm(roda: Roda): RodaFormValues {
  return {
    title: roda.title,
    date: toLocalInput(roda.date),
    description: roda.description ?? "",
    location: roda.location ?? "",
    ...coordinatesToForm(roda),
    stateId: idToField(roda.stateId),
    cityId: idToField(roda.cityId),
    imageUrl: roda.imageUrl ?? "",
    recurrence: roda.recurrence ?? "NONE",
    recurrenceUntil: roda.recurrenceUntil ? roda.recurrenceUntil.slice(0, 10) : "",
  };
}

/** CRIAR (POST): campos opcionais vazios são omitidos. Para editar use `buildRodaUpdatePayload`. */
export function buildRodaPayload(values: RodaFormValues): RodaPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    description: optionalText(values.description),
    location: optionalText(values.location),
    ...coordinatesCreatePayload(values),
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
    ...(values.recurrence !== "NONE"
      ? {
          recurrence: values.recurrence as Recurrence,
          recurrenceUntil: optionalText(values.recurrenceUntil),
        }
      : {}),
  };
}

/**
 * EDITAR (PATCH): opcionais esvaziados vão como `null` (limpa a coluna; imageUrl `""` daria 400).
 * title/date são obrigatórios e nunca vão `null`. communityId não tem campo no painel (não é enviado).
 * latitude/longitude só vão quando o usuário as mudou (ver coordinatesUpdatePayload).
 */
export function buildRodaUpdatePayload(values: RodaFormValues, original: Roda | null = null): RodaPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    description: nullableText(values.description),
    location: nullableText(values.location),
    ...coordinatesUpdatePayload(values, original ?? {}),
    stateId: nullableId(values.stateId),
    cityId: nullableId(values.cityId),
    imageUrl: nullableText(values.imageUrl),
    // Ocorrência gerada (parentRodaId) nunca recebe recurrence != NONE (400): os campos nem são enviados.
    ...(original?.parentRodaId
      ? {}
      : {
          recurrence: values.recurrence as Recurrence,
          recurrenceUntil: values.recurrence === "NONE" ? null : nullableText(values.recurrenceUntil),
        }),
  };
}