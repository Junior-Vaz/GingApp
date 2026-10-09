import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Unidade como o seletor a enxerga (subconjunto de GET /units). */
export interface UnitOption {
  id: number;
  name: string;
  status?: "ACTIVE" | "INACTIVE";
}

/** Resultados por busca de unidade (o backend aceita 1..200). */
export const UNIT_SEARCH_LIMIT = 20;

/** Unidade por id muda pouco: evita refazer GET /units/:id a cada abertura de formulário. */
const UNIT_BY_ID_STALE_MS = 5 * 60 * 1000;

/** Busca de unidades NO SERVIDOR: GET /units?q=&limit=20 (q vazio = as 20 mais recentes). */
export function useUnitSearch(q: string) {
  const params = { q, limit: UNIT_SEARCH_LIMIT };
  return useQuery({
    queryKey: ["units", "search", params],
    queryFn: () => api.getPage<UnitOption>("/units", params),
    placeholderData: keepPreviousData,
  });
}

/** Uma unidade por id (GET /units/:id): resolve a unidade atual de um registro em edição. */
export function useUnitById(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["units", "detail", id],
    queryFn: () => api.get<UnitOption>(`/units/${String(id)}`),
    enabled: enabled && typeof id === "number",
    staleTime: UNIT_BY_ID_STALE_MS,
    retry: false,
  });
}

/**
 * Nomes das unidades de uma página de registros (ex.: coluna "Público" dos Comunicados): 1 GET
 * /units/:id por id distinto (cache compartilhado com `useUnitById`). Devolve `nameOf(id, fallback)`;
 * `fallback` (padrão "—") para sem unidade/ainda carregando/falha.
 */
export function useUnitNames(ids: readonly (number | null | undefined)[]) {
  const distinct = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  const results = useQueries({
    queries: distinct.map((id) => ({
      queryKey: ["units", "detail", id],
      queryFn: () => api.get<UnitOption>(`/units/${String(id)}`),
      staleTime: UNIT_BY_ID_STALE_MS,
      retry: false,
    })),
  });
  const names = new Map<number, string>();
  results.forEach((result, index) => {
    if (result.data) names.set(distinct[index]!, result.data.name);
  });
  return (id: number | null | undefined, fallback = "—"): string =>
    typeof id === "number" ? (names.get(id) ?? fallback) : fallback;
}
