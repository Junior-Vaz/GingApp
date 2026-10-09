import { z } from "zod";

export type ClassStatus = "ACTIVE" | "INACTIVE";

export interface ClassItem {
  id: number;
  unitId: number | null;
  name: string;
  description: string | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  status: ClassStatus;
}

export interface Unit {
  id: number;
  name: string;
}

/** Corpo aceito por POST /classes e PATCH /classes/:id (CreateClassDto / UpdateClassDto). */
export interface ClassInput {
  name: string;
  unitId?: number | undefined;
  description?: string | undefined;
  weekday?: number | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  status?: ClassStatus | undefined;
}

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
  weekday: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  description: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
export type ClassFormValues = z.infer<typeof classSchema>;

export const emptyClassForm: ClassFormValues = {
  name: "",
  unitId: "",
  weekday: "",
  startTime: "",
  endTime: "",
  description: "",
  status: "ACTIVE",
};

export function classToForm(c: ClassItem): ClassFormValues {
  return {
    name: c.name,
    unitId: c.unitId ? String(c.unitId) : "",
    weekday: c.weekday !== null && c.weekday !== undefined ? String(c.weekday) : "",
    startTime: c.startTime ?? "",
    endTime: c.endTime ?? "",
    description: c.description ?? "",
    status: c.status,
  };
}

export function classToPayload(values: ClassFormValues): ClassInput {
  return {
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : undefined,
    weekday: values.weekday !== "" ? Number(values.weekday) : undefined,
    startTime: values.startTime || undefined,
    endTime: values.endTime || undefined,
    description: values.description.trim() || undefined,
    status: values.status,
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
