import { z } from "zod";
import { BR_UFS } from "@/lib/br-ufs";
import { createCrud } from "@/lib/crud";
import { isImageRef } from "@/lib/uploads";
import {
  coordinatesCreatePayload,
  coordinatesToForm,
  coordinatesUpdatePayload,
  hasHalfCoordinates,
  latitudeField,
  longitudeField,
} from "@/lib/map";

export type UnitStatus = "ACTIVE" | "INACTIVE";

/** Contrato de GET /units (backend: UnitsService - paginado: limit/offset/q no nome + status). */
export interface Unit {
  id: number;
  organizationId: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  /** Posição no mapa da comunidade (opcional). */
  latitude?: number | null;
  longitude?: number | null;
  isMain: boolean;
  status: UnitStatus;
  /** Foto/logo da unidade: caminho `/api/uploads/<arquivo>` ou URL http(s). */
  photo?: string | null;
}

/**
 * Corpo de POST /units (CreateUnitDto: name, address, city, state, isMain - sem status) e de PATCH
 * /units/:id (UpdateUnitDto: os mesmos + status; `null` limpa endereço/cidade/UF).
 */
export interface UnitInput {
  name?: string | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  /** Posição no mapa: o par junto; `null`/`null` limpa; omitido = não mexe (o servidor geocodifica se o endereço mudou). */
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  isMain?: boolean | undefined;
  status?: UnitStatus | undefined;
  /** URL de upload / http(s); no PATCH, `null` remove a foto. */
  photo?: string | null | undefined;
}

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = { ACTIVE: "Ativa", INACTIVE: "Inativa" };

/** CRUD de /units: DELETE só INATIVA (nunca apaga); reativar é PATCH { status: "ACTIVE" }. */
export const units = createCrud<Unit, UnitInput>("/units", {
  created: "Unidade criada.",
  updated: "Unidade atualizada.",
  removed: "Unidade inativada.",
});

export const locationOf = (unit: Unit): string =>
  [unit.city, unit.state].filter(Boolean).join(" / ") || "-";

export const unitSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome da unidade (mínimo 2 letras)."),
    address: z.string().trim().max(200, "O endereço pode ter no máximo 200 caracteres."),
    city: z.string().trim().max(100, "A cidade pode ter no máximo 100 caracteres."),
    state: z.string().refine((v) => v === "" || (BR_UFS as readonly string[]).includes(v), "Escolha uma UF válida."),
    latitude: latitudeField,
    longitude: longitudeField,
    isMain: z.boolean(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    photo: z
      .string()
      .trim()
      .refine((v) => v === "" || isImageRef(v), "Informe uma URL válida (http/https) ou envie uma imagem.")
      .optional(),
  })
  .refine((values) => !hasHalfCoordinates(values), {
    path: ["longitude"],
    message: "Informe a latitude e a longitude juntas (ou deixe as duas vazias).",
  });
export type UnitFormValues = z.infer<typeof unitSchema>;

export const emptyUnitForm: UnitFormValues = {
  name: "",
  address: "",
  city: "",
  state: "",
  latitude: "",
  longitude: "",
  isMain: false,
  status: "ACTIVE",
  photo: "",
};

export function unitToForm(unit: Unit): UnitFormValues {
  return {
    name: unit.name,
    address: unit.address ?? "",
    city: unit.city ?? "",
    state: unit.state ?? "",
    ...coordinatesToForm(unit),
    isMain: unit.isMain,
    status: unit.status,
    photo: unit.photo ?? "",
  };
}

/** CRIAR: campos vazios omitidos; sem `status` (CreateUnitDto não tem - forbidNonWhitelisted devolve 400). */
export function unitToCreatePayload(values: UnitFormValues): UnitInput {
  return {
    name: values.name.trim(),
    address: values.address.trim() || undefined,
    city: values.city.trim() || undefined,
    state: values.state || undefined,
    ...coordinatesCreatePayload(values),
    isMain: values.isMain,
    photo: values.photo?.trim() || undefined,
  };
}

/**
 * EDITAR (PATCH): opcionais esvaziados vão como `null` (o backend limpa a coluna). `isMain` só é enviado
 * quando MUDA para true (virar matriz): reenviar `false` na matriz atual é 409 ("defina OUTRA unidade como
 * matriz") e a troca de matriz é sempre "marcar a nova". `status` só quando mudou (reativar passa pelo
 * limite do plano; inativar passa pelas travas de matriz/única ativa).
 */
export function unitToUpdatePayload(values: UnitFormValues, original: Unit): UnitInput {
  const payload: UnitInput = {
    name: values.name.trim(),
    address: values.address.trim() || null,
    city: values.city.trim() || null,
    state: values.state || null,
    // Só quando o usuário mudou as coordenadas: assim, trocar só o endereço faz o servidor re-geocodificar.
    ...coordinatesUpdatePayload(values, original),
    photo: values.photo?.trim() || null,
  };
  if (values.isMain && !original.isMain) payload.isMain = true;
  if (values.status !== original.status) payload.status = values.status;
  return payload;
}
