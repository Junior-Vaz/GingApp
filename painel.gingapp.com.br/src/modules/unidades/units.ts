import { createCrud } from "@/lib/crud";

/** Contrato de GET /units (backend: UnitsService.findAll - somente leitura, paginado: limit/offset/q no nome). */
export interface Unit {
  id: number;
  organizationId: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  isMain: boolean;
  status: "ACTIVE" | "INACTIVE";
}

/** Só leitura: o backend não tem POST/PATCH/DELETE de unidades (use apenas `usePage`). */
export const units = createCrud<Unit>("/units");

export const locationOf = (unit: Unit): string =>
  [unit.city, unit.state].filter(Boolean).join(" / ") || "-";
