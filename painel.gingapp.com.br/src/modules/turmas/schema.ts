import { z } from "zod";
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
});
export type ClassFormValues = z.infer<typeof classSchema>;

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
  };
}

/** CRIAR (base do POST): campos vazios são omitidos. Para editar use `classToUpdatePayload`. */
export function classToPayload(values: ClassFormValues): ClassInput {
  return {
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
export function classToUpdatePayload(values: ClassFormValues): ClassInput {
  return {
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
