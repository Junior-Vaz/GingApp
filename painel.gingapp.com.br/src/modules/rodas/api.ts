import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import type { GenerateOccurrencesResult, Roda, RodaPayload } from "./types";

export const rodas = createCrud<Roda, RodaPayload>("/rodas", {
  created: "Roda criada.",
  updated: "Roda atualizada.",
  removed: "Roda excluída.",
});

/** "3 ocorrências criadas (toda 1ª sexta do mês)." */
export function occurrencesMessage(result: GenerateOccurrencesResult): string {
  const created = `${String(result.created)} ${result.created === 1 ? "ocorrência criada" : "ocorrências criadas"}`;
  return result.rule ? `${created} (${result.rule}).` : `${created}.`;
}

/** POST /rodas/:id/generate-occurrences { count } (idempotente; 1 a 12, padrão 3). Só roda "mãe" recorrente. */
export function useGenerateOccurrences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, count }: { id: number; count: number }) =>
      api.post<GenerateOccurrencesResult>(`/rodas/${String(id)}/generate-occurrences`, { count }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: rodas.rootKey });
      toast.success(occurrencesMessage(result));
    },
    onError: (error) => notifyError(error, "Não foi possível gerar as ocorrências."),
  });
}

/** DELETE /rodas/:id?series=true apaga a roda "mãe" e todas as ocorrências. */
export function useRemoveSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ success: boolean; removed: number }>(`/rodas/${String(id)}?series=true`),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: rodas.rootKey });
      const removed = result?.removed;
      toast.success(removed ? `Série excluída (${String(removed)} rodas removidas).` : "Série excluída.");
    },
    onError: (error) => notifyError(error, "Não foi possível excluir a série."),
  });
}
