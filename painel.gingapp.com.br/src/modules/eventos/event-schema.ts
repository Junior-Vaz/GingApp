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
} from "@/modules/rodas/form-utils";
import { EVENT_STATUSES, EVENT_TYPES, type EventItem, type EventPayload, type EventStatus } from "./types";

/** Reais digitados ("49,90", "50", "49.9") -> centavos; `null` se inválido. */
export function reaisToCents(value: string): number | null {
  const text = value.trim().replace(/^R\$\s*/, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** Centavos -> texto do campo em reais ("49,90"); `null`/0 = gratuito = vazio. */
export function centsToReais(cents: number | null | undefined): string {
  return cents ? (cents / 100).toFixed(2).replace(".", ",") : "";
}

const optionalCents = (value: string): number | undefined => (value.trim() ? (reaisToCents(value) ?? undefined) : undefined);
const nullableCents = (value: string): number | null => (value.trim() ? reaisToCents(value) : null);
const optionalInt = (value: string): number | undefined => (value.trim() ? Number(value) : undefined);
const nullableInt = (value: string): number | null => (value.trim() ? Number(value) : null);
const optionalIso = (value: string): string | undefined => (value ? fromLocalInput(value) : undefined);
const nullableIso = (value: string): string | null => (value ? fromLocalInput(value) : null);

export const eventSchema = z
  .object({
    title: z.string().trim().min(2, "Informe o título do evento (mínimo 2 caracteres)."),
    date: z.string().min(1, "Informe a data do evento."),
    type: z.string().refine((value) => EVENT_TYPES.includes(value), "Escolha o tipo."),
    description: z.string(),
    location: z.string(),
    latitude: latitudeField,
    longitude: longitudeField,
    unitId: z.string(),
    isPublic: z.boolean(),
    stateId: z.string(),
    cityId: z.string(),
    imageUrl: z
      .string()
      .trim()
      .refine((value) => value === "" || isImageRef(value), "Informe uma URL válida (http/https)."),
    capacity: z
      .string()
      .trim()
      .refine((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1), "Informe um número de vagas inteiro, de 1 em diante (ou deixe vazio)."),
    price: z
      .string()
      .trim()
      .refine((value) => value === "" || reaisToCents(value) !== null, "Informe o valor em reais, ex.: 49,90 (ou deixe vazio)."),
    status: z.string().refine((value) => (EVENT_STATUSES as string[]).includes(value), "Escolha a situação."),
    registrationDeadline: z.string(),
  })
  .refine((values) => !hasHalfCoordinates(values), {
    path: ["longitude"],
    message: "Informe a latitude e a longitude juntas (ou deixe as duas vazias).",
  })
  .refine((values) => !values.registrationDeadline || !values.date || values.registrationDeadline <= values.date, {
    path: ["registrationDeadline"],
    message: "O prazo de inscrição não pode ser depois da data do evento.",
  });

export type EventFormValues = z.infer<typeof eventSchema>;

export const emptyEvent: EventFormValues = {
  title: "",
  date: "",
  type: "OUTRO",
  description: "",
  location: "",
  latitude: "",
  longitude: "",
  unitId: "",
  isPublic: false,
  stateId: "",
  cityId: "",
  imageUrl: "",
  capacity: "",
  price: "",
  status: "PUBLISHED",
  registrationDeadline: "",
};

export function eventToForm(event: EventItem): EventFormValues {
  return {
    title: event.title,
    date: toLocalInput(event.date),
    type: event.type,
    description: event.description ?? "",
    location: event.location ?? "",
    ...coordinatesToForm(event),
    unitId: idToField(event.unitId),
    isPublic: event.isPublic,
    stateId: idToField(event.stateId),
    cityId: idToField(event.cityId),
    imageUrl: event.imageUrl ?? "",
    capacity: event.capacity ? String(event.capacity) : "",
    price: centsToReais(event.priceCents),
    status: (event.status ?? "PUBLISHED") satisfies EventStatus,
    registrationDeadline: toLocalInput(event.registrationDeadline),
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
    ...coordinatesCreatePayload(values),
    unitId: optionalId(values.unitId),
    isPublic: values.isPublic,
    stateId: optionalId(values.stateId),
    cityId: optionalId(values.cityId),
    imageUrl: optionalText(values.imageUrl),
    capacity: optionalInt(values.capacity),
    priceCents: optionalCents(values.price),
    status: values.status as EventStatus,
    registrationDeadline: optionalIso(values.registrationDeadline),
  };
}

/**
 * EDITAR (PATCH): opcionais esvaziados vão como `null` (o backend limpa a coluna; imageUrl `""`
 * daria 400). title/date/type/isPublic são obrigatórios e nunca vão `null`.
 * latitude/longitude só vão quando o usuário as mudou (ver coordinatesUpdatePayload).
 */
export function buildEventUpdatePayload(values: EventFormValues, original: EventItem | null = null): EventPayload {
  return {
    title: values.title.trim(),
    date: fromLocalInput(values.date),
    type: values.type,
    description: nullableText(values.description),
    location: nullableText(values.location),
    ...coordinatesUpdatePayload(values, original ?? {}),
    unitId: nullableId(values.unitId),
    isPublic: values.isPublic,
    stateId: nullableId(values.stateId),
    cityId: nullableId(values.cityId),
    imageUrl: nullableText(values.imageUrl),
    capacity: nullableInt(values.capacity),
    priceCents: nullableCents(values.price),
    status: values.status as EventStatus,
    registrationDeadline: nullableIso(values.registrationDeadline),
  };
}