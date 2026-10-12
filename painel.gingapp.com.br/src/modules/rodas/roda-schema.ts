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
} from "./form-utils";
import type { Roda, RodaPayload } from "./types";

export const rodaSchema = z.object({
  title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
  date: z.string().min(1, "Informe a data e a hora."),
  description: z.string(),
  location: z.string(),
  stateId: z.string(),
  cityId: z.string(),
  imageUrl: z
    .string()
    .trim()
    .refine((value) => value === "" || isImageRef(value), "Informe uma URL válida (http/https)."),
});

export type RodaFormValues = z.infer<typeof rodaSchema>;

export const emptyRoda: RodaFormValues = {
  title: "",
  date: "",
  description: "",
  location: "",
  stateId: "",
  cityId: "",
  imageUrl: "",
};

export function rodaToForm(roda: Roda): RodaFormValues {
  return {
    title: roda.title,
    date: toLocalInput(roda.date),
    description: roda.description ?? "",
    location: roda.location ?? "",
    stateId: idToField(roda.stateId),
    cityId: idToField(roda.cityId),
    imageUrl: roda.imageUrl ?? "",
  };
}

/** CRIAR (POST): campos opcionais vazios são omitidos. Para editar use `buildRodaUpdatePayload`. */
export function buildRodaPayload(values: RodaFormValues): RodaPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    description: optionalText(values.description),
    location: optionalText(values.location),
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
  };
}

/**
 * EDITAR (PATCH): opcionais esvaziados vão como `null` (limpa a coluna; imageUrl `""` daria 400).
 * title/date são obrigatórios e nunca vão `null`. communityId não tem campo no painel (não é enviado).
 */
export function buildRodaUpdatePayload(values: RodaFormValues): RodaPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    description: nullableText(values.description),
    location: nullableText(values.location),
    stateId: nullableId(values.stateId),
    cityId: nullableId(values.cityId),
    imageUrl: nullableText(values.imageUrl),
  };
}