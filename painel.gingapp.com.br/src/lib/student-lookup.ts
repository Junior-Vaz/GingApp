import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Aluno como o seletor o enxerga (subconjunto de GET /students). */
export interface StudentOption {
  id: number;
  name: string;
  status?: "ACTIVE" | "INACTIVE";
}

/** Resultados por busca de aluno (o backend aceita 1..200). */
export const STUDENT_SEARCH_LIMIT = 20;

/** Aluno por id muda pouco: evita refazer GET /students/:id a cada abertura de formulário. */
const STUDENT_BY_ID_STALE_MS = 5 * 60 * 1000;

/** Busca de alunos NO SERVIDOR: GET /students?q=&limit=20 (q vazio = os 20 mais recentes). */
export function useStudentSearch(q: string) {
  const params = { q, limit: STUDENT_SEARCH_LIMIT };
  return useQuery({
    queryKey: ["students", "search", params],
    queryFn: () => api.getPage<StudentOption>("/students", params),
    placeholderData: keepPreviousData,
  });
}

/** Um aluno por id (GET /students/:id): resolve o aluno atual de um registro em edição. */
export function useStudentById(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["students", "detail", id],
    queryFn: () => api.get<StudentOption>(`/students/${String(id)}`),
    enabled: enabled && typeof id === "number",
    staleTime: STUDENT_BY_ID_STALE_MS,
    retry: false,
  });
}

/**
 * Nomes dos alunos de uma página de registros (ex.: coluna "Aluno" do Financeiro): 1 GET
 * /students/:id por id distinto (cache compartilhado com `useStudentById`). Devolve `nameOf(id)`
 * com "—" para sem aluno/ainda carregando/falha.
 */
export function useStudentNames(ids: readonly (number | null | undefined)[]) {
  const distinct = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  const results = useQueries({
    queries: distinct.map((id) => ({
      queryKey: ["students", "detail", id],
      queryFn: () => api.get<StudentOption>(`/students/${String(id)}`),
      staleTime: STUDENT_BY_ID_STALE_MS,
      retry: false,
    })),
  });
  const names = new Map<number, string>();
  results.forEach((result, index) => {
    if (result.data) names.set(distinct[index]!, result.data.name);
  });
  return (id: number | null | undefined): string => (typeof id === "number" ? (names.get(id) ?? "—") : "—");
}
