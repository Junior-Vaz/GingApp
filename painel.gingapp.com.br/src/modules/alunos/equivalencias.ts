import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, buildQuery } from "@/lib/api";
import type { RopeStyle } from "@/lib/rope";
import { studentFichaKey } from "./ficha";

/** Nível de graduação como o backend o devolve nas equivalências (corda = style + colors). */
export interface EquivalenceLevel {
  id: number;
  name: string;
  order: number;
  color?: string | null | undefined;
  style?: RopeStyle | null | undefined;
  colors?: string[] | null | undefined;
}

/** Uma linha de GET /graduations/equivalences/suggestions: uma corda de origem compartilhada do aluno (só MESTRE). */
export interface EquivalenceSuggestion {
  fromLevel: EquivalenceLevel;
  fromSystem: { id: number; name: string; levelsCount: number };
  fromOrganization: { id: number; name: string; logoUrl: string | null };
  graduatedAt: string;
  /** Equivalência que o grupo já declarou para esta corda de origem. */
  declared: EquivalenceLevel | null;
  /** Sugestão automática (posição proporcional na escala); só quando não há declarada. */
  suggested: EquivalenceLevel | null;
  toSystem: { id: number; name: string } | null;
  /** O grupo já criou a graduação equivalente ("Reconhecida") para este aluno. */
  recognized: boolean;
}

export interface EquivalenceResult {
  equivalence: {
    id: number;
    fromLevel: EquivalenceLevel;
    toLevel: EquivalenceLevel;
    fromOrganization: { id: number; name: string };
  };
  recognizedGraduation: { id: number; graduatedAt: string; graduationLevelId: number; notes: string | null } | null;
}

export interface EquivalenceInput {
  fromLevelId: number;
  toLevelId: number;
  /** Com o id do aluno, além de declarar a equivalência o grupo cria a graduação reconhecida. */
  recognizeForStudentId?: number | undefined;
}

export const equivalenceSuggestionsKey = (studentId: number) => ["equivalence-suggestions", studentId] as const;

/** GET /graduations/equivalences/suggestions?studentId=N; só o MESTRE (a seção só monta para ele). */
export function useEquivalenceSuggestions(studentId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: equivalenceSuggestionsKey(studentId ?? 0),
    queryFn: () =>
      api.get<EquivalenceSuggestion[]>(`/graduations/equivalences/suggestions${buildQuery({ studentId })}`),
    enabled: enabled && studentId !== undefined,
    retry: false,
  });
}

/** POST /graduations/equivalences (idempotente). Reconhecer cria uma graduação: atualiza a ficha. */
export function useSaveEquivalence(studentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EquivalenceInput) => api.post<EquivalenceResult>("/graduations/equivalences", data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: equivalenceSuggestionsKey(studentId) });
      void queryClient.invalidateQueries({ queryKey: studentFichaKey(studentId) });
    },
  });
}

const EQUIVALENCE_ERROR_MESSAGE: Record<string, string> = {
  INVALID_TO_LEVEL: "Escolha um nível que pertença a um sistema de graduação do seu grupo.",
  NOT_SHARED_GRADUATION: "Esta corda de origem não foi compartilhada com o seu grupo.",
};

export function equivalenceErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return (error.code && EQUIVALENCE_ERROR_MESSAGE[error.code]) || error.message || fallback;
  return fallback;
}
