import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Contrato de GET /units (backend: UnitsService.findAll - somente leitura, até 50 itens). */
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

export const UNITS_QUERY_KEY = ["units"] as const;

/** Lista de unidades (compartilhada com Comunicados, que usa para escolher o escopo). */
export function useUnits() {
  return useQuery({
    queryKey: UNITS_QUERY_KEY,
    queryFn: () => api.get<Unit[]>("/units"),
  });
}

export const locationOf = (unit: Unit): string =>
  [unit.city, unit.state].filter(Boolean).join(" / ") || "-";
