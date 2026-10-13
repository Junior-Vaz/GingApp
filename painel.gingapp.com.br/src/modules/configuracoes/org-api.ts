import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Organization } from "./plan";

/** Chave da própria organização (GET /organizations): Configurações e quem precisa de uma preferência do grupo. */
export const ORG_KEY = ["organizations", "own"] as const;

/** GET /organizations devolve o objeto (MEMBER) ou uma lista (PLATFORM): normaliza para um objeto ou null. */
export async function fetchOwnOrganization(): Promise<Organization | null> {
  const data = await api.get<Organization | Organization[] | null>("/organizations");
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

export function useOwnOrganization() {
  return useQuery({ queryKey: ORG_KEY, queryFn: fetchOwnOrganization });
}
