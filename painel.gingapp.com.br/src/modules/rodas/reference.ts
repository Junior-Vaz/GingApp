import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { City, State } from "./types";

/** Dados públicos de referência (sem organização): GET /rodas/reference/states|cities. */
export function useStates() {
  return useQuery({
    queryKey: ["reference", "states"],
    queryFn: () => api.get<State[]>("/rodas/reference/states"),
    staleTime: 60 * 60 * 1000,
  });
}

export function useCities(stateId: number | undefined) {
  return useQuery({
    queryKey: ["reference", "cities", stateId],
    queryFn: () => api.get<City[]>(`/rodas/reference/cities?stateId=${String(stateId)}`),
    enabled: stateId !== undefined,
    staleTime: 60 * 60 * 1000,
  });
}
/** Teto de `limit` do backend; listas auxiliares (selects) pedem a página máxima. */
export const AUX_LIMIT = 200;

/**
 * Lista auxiliar para <select> (unidades, alunos...): `GET path?limit=200` + total do header.
 * `truncated` = há mais itens do que os 200 carregados (mostre `AuxLimitNotice`).
 */
export function useAuxList<T>(path: string, enabled = true) {
  const query = useQuery({
    queryKey: ["aux", path, AUX_LIMIT],
    queryFn: () => api.getPage<T>(path, { limit: AUX_LIMIT }),
    enabled,
  });
  return {
    items: query.data?.items,
    total: query.data?.total ?? 0,
    truncated: (query.data?.total ?? 0) > (query.data?.items.length ?? 0),
    isLoading: query.isLoading,
    error: query.error,
  };
}