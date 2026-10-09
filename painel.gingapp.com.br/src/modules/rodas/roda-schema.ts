import { z } from "zod";
import { fromLocalInput, idToField, isHttpUrl, optionalId, optionalText, toLocalInput } from "./form-utils";
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
    .refine((value) => value === "" || isHttpUrl(value), "Informe uma URL válida (http/https)."),
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

/** Valores do formulário -> corpo do POST/PATCH. No PATCH, texto vazio é enviado para limpar o campo. */
export function buildRodaPayload(values: RodaFormValues, isEdit: boolean): RodaPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    description: isEdit ? values.description : optionalText(values.description),
    location: isEdit ? values.location.trim() : optionalText(values.location),
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
  };
}
