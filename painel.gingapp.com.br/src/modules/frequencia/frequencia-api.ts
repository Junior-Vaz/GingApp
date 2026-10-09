import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Page } from "@/lib/api";
import type { ClassOption, Lesson } from "@/modules/aulas/aulas-api";

/** Teto de itens por chamada do backend (`limit` 1..200). */
export const SELECTOR_LIMIT = 200;

export interface LessonFilters {
  classId: string;
  from: string;
  to: string;
}

/**
 * Aulas ATIVAS para o seletor da chamada (GET /lessons?status=ACTIVE&limit=200[&classId&from&to]).
 * Filtros no servidor: sem eles, só as 200 aulas mais recentes (por id) chegam; com turma/período
 * o usuário alcança aulas antigas. `total` vem do header X-Total-Count.
 */
export function useLessonSelector(filters: LessonFilters) {
  const params = {
    status: "ACTIVE",
    classId: filters.classId,
    from: filters.from,
    to: filters.to,
    limit: SELECTOR_LIMIT,
  };
  return useQuery<Page<Lesson>>({
    queryKey: ["frequencia", "lessons", params],
    queryFn: () => api.getPage<Lesson>("/lessons", params),
    placeholderData: keepPreviousData,
  });
}

/** Turmas para o filtro (GET /classes?limit=200). */
export function useClassSelector() {
  return useQuery<Page<ClassOption>>({
    queryKey: ["frequencia", "classes", SELECTOR_LIMIT],
    queryFn: () => api.getPage<ClassOption>("/classes", { limit: SELECTOR_LIMIT }),
  });
}
