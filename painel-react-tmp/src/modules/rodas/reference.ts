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