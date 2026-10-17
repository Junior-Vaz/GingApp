import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Turma como o cadastro rápido de aluno precisa (GET /classes?status=ACTIVE). */
export interface ActiveClass {
  id: number;
  name: string;
  unitId: number | null;
  unit?: { id: number; name: string } | null | undefined;
}

const CLASSES_LIMIT = 200;

/** Turmas ATIVAS do grupo (até 200) para escolher no cadastro do aluno; só busca com `enabled` (sheet aberto). */
export function useActiveClasses(enabled: boolean) {
  return useQuery({
    queryKey: ["alunos", "active-classes"],
    queryFn: async () => {
      const page = await api.getPage<ActiveClass>("/classes", { status: "ACTIVE", limit: CLASSES_LIMIT });
      return {
        items: [...page.items].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        total: page.total,
      };
    },
    enabled,
  });
}
