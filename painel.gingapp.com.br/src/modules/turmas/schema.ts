import { z } from "zod";
import { BR_UFS } from "@/lib/br-ufs";
import {
  coordinatesCreatePayload,
  coordinatesToForm,
  coordinatesUpdatePayload,
  hasHalfCoordinates,
  latitudeField,
  longitudeField,
} from "@/lib/map";
import { isImageRef } from "@/lib/uploads";

export type ClassStatus = "ACTIVE" | "INACTIVE";

export interface ClassItem {
  id: number;
  unitId: number | null;
  name: string;
  description: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  /** Professor responsável: User.id de um membro ativo MESTRE/PROFESSOR do grupo. */
  teacherUserId: number | null;
  status: ClassStatus;
  /** Foto da turma: caminho `/api/uploads/<arquivo>` ou URL http(s). */
  photo?: string | null;
  /** Unidade/professor já resolvidos pelo servidor (nome + foto) para listas; ausentes em respostas antigas. */
  unit?: { id: number; name: string; photo?: string | null } | null;
  teacher?: { id: number; name: string; photo?: string | null } | null;
  /** Geração contínua de aulas: o sistema mantém ~60 dias de aulas à frente automaticamente. */
  autoGenerateLessons?: boolean;
  /**
   * Local do treino PRÓPRIO (opcional; mesmo desenho da Unidade). Tudo vazio = a turma usa o endereço e a posição da
   * unidade. Ausentes em respostas antigas da API.
   */
  locationLabel?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Só na lista (GET /classes): a aula mais próxima (hoje em diante) de qualquer status, ou null. */
  nextLesson?: { date: string; status: "ACTIVE" | "INACTIVE" } | null;
  /** Só na lista: a aula ATIVA mais próxima (hoje em diante), ou null. */
  nextActiveLesson?: { date: string } | null;
}

/**
 * Corpo aceito por POST /classes e PATCH /classes/:id (CreateClassDto / UpdateClassDto).
 * No PATCH, `null` LIMPA unitId/description/weekday/startTime/endTime/teacherUserId; `name` e `status` nunca vão `null` (400).
 */
export interface ClassInput {
  name: string;
  unitId?: number | null | undefined;
  teacherUserId?: number | null | undefined;
  description?: string | null | undefined;
  weekday?: number | null | undefined;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  status?: ClassStatus | undefined;
  /** URL de upload / http(s); no PATCH, `null` remove a foto. */
  photo?: string | null | undefined;
  autoGenerateLessons?: boolean | undefined;
  /** Local do treino próprio. No PATCH, TUDO `null` = voltar a usar o endereço da unidade; coordenadas: o par junto. */
  locationLabel?: string | null | undefined;
  address?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
}

/** Dias de aulas à frente que o sistema mantém sozinho na geração contínua (texto de ajuda). */
export const CONTINUOUS_AHEAD_DAYS = 60;

export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = { ACTIVE: "Ativa", INACTIVE: "Inativa" };

export const WEEKDAY_LABEL: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

export const classSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da turma (mínimo 2 letras)."),
  unitId: z.string(),
  teacherUserId: z.string(),
  weekday: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  description: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  photo: z
    .string()
    .trim()
    .refine((v) => v === "" || isImageRef(v), "Informe uma URL válida (http/https) ou envie uma imagem.")
    .optional(),
  autoGenerateLessons: z.boolean().optional(),
  /** "unit" (padrão) = usa o endereço/posição da unidade; "custom" = local do treino próprio (campos abaixo). */
  locationMode: z.enum(["unit", "custom"]).optional(),
  locationLabel: z.string().trim().max(120, "O nome do local pode ter no máximo 120 caracteres.").optional(),
  address: z.string().trim().max(200, "O endereço pode ter no máximo 200 caracteres.").optional(),
  city: z.string().trim().max(100, "A cidade pode ter no máximo 100 caracteres.").optional(),
  state: z
    .string()
    .refine((v) => v === "" || (BR_UFS as readonly string[]).includes(v), "Escolha uma UF válida.")
    .optional(),
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
}).refine((values) => !hasHalfCoordinates({ latitude: values.latitude ?? "", longitude: values.longitude ?? "" }), {
  path: ["longitude"],
  message: "Informe a latitude e a longitude juntas (ou deixe as duas vazias).",
});
export type ClassFormValues = z.infer<typeof classSchema>;

type OwnLocation = Pick<ClassItem, "locationLabel" | "address" | "city" | "state" | "latitude" | "longitude">;

/** A turma tem local do treino próprio (qualquer campo preenchido)? Senão ela usa o endereço/posição da unidade. */
export function hasOwnLocation(c: OwnLocation): boolean {
  return [c.locationLabel, c.address, c.city, c.state, c.latitude].some((v) => v !== null && v !== undefined && v !== "");
}

/** Resumo do local próprio para a lista ("Praça X · Av. Y, 10 · Goiânia / GO"), ou null quando herda da unidade. */
export function classLocationSummary(c: OwnLocation): string | null {
  if (!hasOwnLocation(c)) return null;
  const cityUf = [c.city, c.state].filter(Boolean).join(" / ");
  return [c.locationLabel, c.address, cityUf].filter(Boolean).join(" · ") || "Local próprio (só a posição no mapa)";
}

/** Local próprio com endereço mas SEM posição: não aparece no mapa (o app mostra a posição da unidade). */
export function classLocationMissingPin(c: OwnLocation): boolean {
  const hasText = [c.address, c.city, c.state].some((v) => v !== null && v !== undefined && v !== "");
  return hasText && (c.latitude === null || c.latitude === undefined || c.longitude === null || c.longitude === undefined);
}

export const emptyClassForm: ClassFormValues = {
  name: "",
  unitId: "",
  teacherUserId: "",
  weekday: "",
  startTime: "",
  endTime: "",
  description: "",
  status: "ACTIVE",
  photo: "",
  autoGenerateLessons: true, // turma nova nasce com aulas contínuas ligadas
  locationMode: "unit", // padrão: usa o endereço da unidade
  locationLabel: "",
  address: "",
  city: "",
  state: "",
  latitude: "",
  longitude: "",
};

export function classToForm(c: ClassItem): ClassFormValues {
  return {
    name: c.name,
    unitId: c.unitId ? String(c.unitId) : "",
    teacherUserId: c.teacherUserId ? String(c.teacherUserId) : "",
    weekday: c.weekday !== null && c.weekday !== undefined ? String(c.weekday) : "",
    startTime: c.startTime ?? "",
    endTime: c.endTime ?? "",
    description: c.description ?? "",
    status: c.status,
    photo: c.photo ?? "",
    autoGenerateLessons: c.autoGenerateLessons ?? false,
    locationMode: hasOwnLocation(c) ? "custom" : "unit",
    locationLabel: c.locationLabel ?? "",
    address: c.address ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    ...coordinatesToForm(c),
  };
}

/** O formulário está em "Local diferente" e tem ao menos um campo de local preenchido? */
function usesOwnLocation(values: ClassFormValues): boolean {
  if (values.locationMode !== "custom") return false;
  return [values.locationLabel, values.address, values.city, values.state, values.latitude, values.longitude].some(
    (v) => (v ?? "").trim() !== "",
  );
}

/** Campos de local para o POST: só no modo "Local diferente" (vazios omitidos; sem lat/lng o servidor geocodifica). */
function locationCreatePayload(values: ClassFormValues): Partial<ClassInput> {
  if (!usesOwnLocation(values)) return {};
  return {
    locationLabel: values.locationLabel?.trim() || undefined,
    address: values.address?.trim() || undefined,
    city: values.city?.trim() || undefined,
    state: values.state || undefined,
    ...coordinatesCreatePayload({ latitude: values.latitude ?? "", longitude: values.longitude ?? "" }),
  };
}

/**
 * Campos de local para o PATCH. "Usar o endereço da unidade": TUDO null, mas só se a turma tinha local próprio (turma
 * sem local e sem `original` não manda nada). "Local diferente": textos (vazio = null) e coordenadas SÓ se mudaram — assim,
 * trocar só o endereço faz o servidor re-geocodificar em vez de manter o ponto antigo.
 */
function locationUpdatePayload(values: ClassFormValues, original?: OwnLocation): Partial<ClassInput> {
  if (!usesOwnLocation(values)) {
    if (!original || !hasOwnLocation(original)) return {};
    return { locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null };
  }
  const form = { latitude: values.latitude ?? "", longitude: values.longitude ?? "" };
  return {
    locationLabel: values.locationLabel?.trim() || null,
    address: values.address?.trim() || null,
    city: values.city?.trim() || null,
    state: values.state || null,
    ...(original ? coordinatesUpdatePayload(form, original) : coordinatesCreatePayload(form)),
  };
}

/** CRIAR (base do POST): campos vazios são omitidos. Para editar use `classToUpdatePayload`. */
export function classToPayload(values: ClassFormValues): ClassInput {
  return {
    ...locationCreatePayload(values),
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : undefined,
    teacherUserId: values.teacherUserId ? Number(values.teacherUserId) : undefined,
    weekday: values.weekday !== "" ? Number(values.weekday) : undefined,
    startTime: values.startTime || undefined,
    endTime: values.endTime || undefined,
    description: values.description.trim() || undefined,
    status: values.status,
    photo: values.photo?.trim() || undefined,
    autoGenerateLessons: values.autoGenerateLessons,
  };
}

/**
 * EDITAR (PATCH): opcionais que o usuário esvaziou vão como `null` (o backend limpa a coluna).
 * `name` e `status` são obrigatórios e nunca vão `null`. weekday "0" (domingo) é válido.
 */
export function classToUpdatePayload(values: ClassFormValues, original?: ClassItem): ClassInput {
  return {
    ...locationUpdatePayload(values, original),
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : null,
    teacherUserId: values.teacherUserId ? Number(values.teacherUserId) : null,
    weekday: values.weekday !== "" ? Number(values.weekday) : null,
    startTime: values.startTime || null,
    endTime: values.endTime || null,
    description: values.description.trim() || null,
    status: values.status,
    photo: values.photo?.trim() || null,
    autoGenerateLessons: values.autoGenerateLessons,
  };
}

/** CreateClassDto não tem `status` (forbidNonWhitelisted devolve 400); só o PATCH aceita. */
export function classToCreatePayload(values: ClassFormValues): ClassInput {
  const payload = classToPayload(values);
  delete payload.status;
  return payload;
}

export function scheduleLabel(c: Pick<ClassItem, "startTime" | "endTime">): string {
  if (!c.startTime && !c.endTime) return "—";
  return `${c.startTime ?? "—"} - ${c.endTime ?? "—"}`;
}

/**
 * Diagnóstico das aulas à frente de uma turma (lista de Turmas). `next` = texto "dd/MM (ativa|cancelada)" ou null;
 * `warning` = aviso discreto quando as aulas contínuas estão ligadas mas não há o que ver à frente:
 *  - sem dia da semana definido: o sistema não gera nada;
 *  - sem nenhuma aula ATIVA à frente: "gerar aulas" (a ação da tela) resolve.
 * Respostas antigas da API (sem os campos) não geram aviso. Turma inativa nunca avisa.
 */
export function classLessonDiagnostic(
  c: Pick<ClassItem, "status" | "weekday" | "autoGenerateLessons" | "nextLesson" | "nextActiveLesson">,
): { next: { day: string; status: "ACTIVE" | "INACTIVE" } | null; warning: "no-weekday" | "no-active" | null } {
  const next = c.nextLesson ? { day: c.nextLesson.date.slice(0, 10), status: c.nextLesson.status } : null;
  let warning: "no-weekday" | "no-active" | null = null;
  if (c.status === "ACTIVE" && c.autoGenerateLessons) {
    if (c.weekday === null || c.weekday === undefined) warning = "no-weekday";
    else if (c.nextActiveLesson === null) warning = "no-active";
  }
  return { next, warning };
}
