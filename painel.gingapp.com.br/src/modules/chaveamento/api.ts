import { queryOptions, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { chaveamentoErrorMessage } from "./errors";
import type {
  AddCompetitorPayload,
  CategoryPayload,
  ImportResult,
  MatchSchedulePayload,
  OperatorCategory,
  ResultPayload,
  Seeding,
  TournamentSummary,
  UpdateCompetitorPayload,
} from "./types";

/** Consulta periódica da categoria aberta (contrato 6): o operador vê o que outro operador fez. */
export const CATEGORY_REFETCH_MS = 5000;

export const tournamentPath = (eventId: number) => `/events/${String(eventId)}/tournament`;

export const chaveamentoKeys = {
  all: (eventId: number) => ["chaveamento", eventId] as const,
  tournament: (eventId: number) => ["chaveamento", eventId, "tournament"] as const,
  category: (eventId: number, categoryId: number) => ["chaveamento", eventId, "category", categoryId] as const,
  participants: (eventId: number) => ["eventos", "participants", eventId] as const,
};

// ---------------------------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------------------------

/** Torneio do evento. `null` = o evento ainda não tem chaveamento (404 TOURNAMENT_NOT_FOUND). */
export function useTournament(eventId: number) {
  return useQuery({
    queryKey: chaveamentoKeys.tournament(eventId),
    queryFn: async (): Promise<TournamentSummary | null> => {
      try {
        return await api.get<TournamentSummary>(tournamentPath(eventId));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && error.code === "TOURNAMENT_NOT_FOUND") return null;
        throw error;
      }
    },
    enabled: Number.isInteger(eventId) && eventId > 0,
    retry: false,
  });
}

/** Consulta da categoria completa (visão do operador): a MESMA chave serve à aba aberta e à mesa de controle. */
const categoryQuery = (eventId: number, categoryId: number | null) =>
  queryOptions({
    queryKey: chaveamentoKeys.category(eventId, categoryId ?? 0),
    queryFn: () => api.get<OperatorCategory>(`${tournamentPath(eventId)}/categories/${String(categoryId)}`),
    enabled: categoryId !== null,
    refetchInterval: CATEGORY_REFETCH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });

/** Categoria completa (visão do operador), com consulta a cada 5 s enquanto a aba está aberta. */
export function useCategory(eventId: number, categoryId: number | null) {
  return useQuery(categoryQuery(eventId, categoryId));
}

/**
 * Categorias EM ANDAMENTO do torneio, para a mesa de controle (lutas ao vivo e próximas de todas as categorias).
 * Reaproveita as mesmas consultas (e o mesmo cache) das abas: abrir a categoria não duplica a chamada.
 */
export function useDeskCategories(eventId: number, runningIds: readonly number[]) {
  return useQueries({
    queries: runningIds.map((id) => categoryQuery(eventId, id)),
    combine: (results) => ({
      categories: results.map((r) => r.data).filter((c): c is OperatorCategory => c !== undefined),
      loading: results.some((r) => r.isLoading),
      failed: results.filter((r) => r.isError).length,
      refetch: () => results.forEach((r) => void r.refetch()),
    }),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------------------------------------------------

const isCategory = (data: unknown): data is OperatorCategory =>
  typeof data === "object" && data !== null && "competitors" in data && "matches" in data && "format" in data;
const isImport = (data: unknown): data is ImportResult =>
  typeof data === "object" && data !== null && "added" in data && "category" in data;
const isSummary = (data: unknown): data is TournamentSummary =>
  typeof data === "object" && data !== null && "publicToken" in data && "categories" in data;

/**
 * Toda mutação devolve a categoria completa, `{ added, skipped, category }` (importação) ou o resumo do torneio: grava
 * no cache (a tela atualiza na hora) e invalida o resumo (contagens e status nas abas) e a categoria (a verdade vem do
 * servidor na próxima consulta).
 */
export function applyResponse(queryClient: QueryClient, eventId: number, data: unknown): void {
  const category = isImport(data) ? data.category : isCategory(data) ? data : null;
  if (category) {
    queryClient.setQueryData(chaveamentoKeys.category(eventId, category.id), category);
    void queryClient.invalidateQueries({ queryKey: chaveamentoKeys.tournament(eventId) });
  } else if (isSummary(data)) {
    queryClient.setQueryData(chaveamentoKeys.tournament(eventId), data);
  }
}

interface MutationOptions<TVars, TData> {
  /** Mensagem de sucesso (toast). Sem ela, nenhum toast (a própria tela já mostra o resultado). */
  success?: string | ((data: TData, vars: TVars) => string);
  /** Mensagem usada quando o erro não tem `code` nem texto do servidor. */
  failure: string;
}

/** Mutação do operador: grava a resposta no cache, avisa por toast e, em erro, mostra a mensagem do `code` e recarrega. */
function useOperatorMutation<TVars, TData>(
  eventId: number,
  mutationFn: (vars: TVars) => Promise<TData>,
  options: MutationOptions<TVars, TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data, vars) => {
      applyResponse(queryClient, eventId, data);
      const message = typeof options.success === "function" ? options.success(data, vars) : options.success;
      if (message) toast.success(message);
    },
    onError: (error) => {
      toast.error(chaveamentoErrorMessage(error, options.failure));
      // O estado pode ter mudado no servidor (outro operador, 409): recarrega a verdade.
      void queryClient.invalidateQueries({ queryKey: chaveamentoKeys.all(eventId) });
    },
  });
}

const base = tournamentPath;

export function useCreateTournament(eventId: number) {
  return useOperatorMutation(eventId, () => api.post<TournamentSummary>(base(eventId)), {
    success: "Chaveamento criado.",
    failure: "Não foi possível criar o chaveamento.",
  });
}

export function useSetPublic(eventId: number) {
  return useOperatorMutation(
    eventId,
    (publicEnabled: boolean) => api.patch<TournamentSummary>(base(eventId), { publicEnabled }),
    {
      success: (_d, on) => (on ? "Telão ligado: quem tem o link já pode assistir." : "Telão desligado."),
      failure: "Não foi possível mudar o telão.",
    },
  );
}

export function useRotateToken(eventId: number) {
  return useOperatorMutation(eventId, () => api.post<TournamentSummary>(`${base(eventId)}/rotate-token`), {
    success: "Novo link gerado. O link antigo parou de funcionar.",
    failure: "Não foi possível gerar um novo link.",
  });
}

export function useCreateCategory(eventId: number) {
  return useOperatorMutation(eventId, (body: CategoryPayload) => api.post<OperatorCategory>(`${base(eventId)}/categories`, body), {
    success: "Categoria criada.",
    failure: "Não foi possível criar a categoria.",
  });
}

export function useUpdateCategory(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ id, data }: { id: number; data: CategoryPayload }) =>
      api.patch<OperatorCategory>(`${base(eventId)}/categories/${String(id)}`, data),
    { success: "Categoria atualizada.", failure: "Não foi possível atualizar a categoria." },
  );
}

export function useDeleteCategory(eventId: number) {
  const queryClient = useQueryClient();
  return useOperatorMutation(
    eventId,
    async (id: number) => {
      const summary = await api.delete<TournamentSummary>(`${base(eventId)}/categories/${String(id)}`);
      queryClient.removeQueries({ queryKey: chaveamentoKeys.category(eventId, id) });
      return summary;
    },
    { success: "Categoria excluída.", failure: "Não foi possível excluir a categoria." },
  );
}

export function useAddCompetitor(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ categoryId, body }: { categoryId: number; body: AddCompetitorPayload }) =>
      api.post<OperatorCategory>(`${base(eventId)}/categories/${String(categoryId)}/competitors`, body),
    { success: "Atleta adicionado.", failure: "Não foi possível adicionar o atleta." },
  );
}

export function useImportParticipants(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ categoryId, ids }: { categoryId: number; ids: number[] }) =>
      api.post<ImportResult>(`${base(eventId)}/categories/${String(categoryId)}/competitors/from-participants`, {
        eventParticipantIds: ids,
      }),
    {
      success: (data) =>
        `${String(data.added)} ${data.added === 1 ? "atleta adicionado" : "atletas adicionados"}` +
        (data.skipped > 0 ? `, ${String(data.skipped)} já estavam na categoria ou não puderam entrar.` : "."),
      failure: "Não foi possível importar os participantes.",
    },
  );
}

export function useUpdateCompetitor(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ id, data }: { id: number; data: UpdateCompetitorPayload }) =>
      api.patch<OperatorCategory>(`${base(eventId)}/competitors/${String(id)}`, data),
    { success: "Atleta atualizado.", failure: "Não foi possível atualizar o atleta." },
  );
}

export function useRemoveCompetitor(eventId: number) {
  return useOperatorMutation(
    eventId,
    (id: number) => api.delete<OperatorCategory>(`${base(eventId)}/competitors/${String(id)}`),
    { success: "Atleta removido.", failure: "Não foi possível remover o atleta." },
  );
}

export function useGenerate(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ categoryId, seeding, regenerate }: { categoryId: number; seeding: Seeding; regenerate?: boolean }) =>
      api.post<OperatorCategory>(`${base(eventId)}/categories/${String(categoryId)}/generate`, {
        seeding,
        ...(regenerate ? { regenerate: true } : {}),
      }),
    {
      success: (_d, vars) => (vars.regenerate ? "Chave sorteada de novo." : "Chave gerada."),
      failure: "Não foi possível gerar a chave.",
    },
  );
}

export function useSwapSlots(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ matchId, slotAId, slotBId }: { matchId: number; slotAId?: number; slotBId?: number }) =>
      api.patch<OperatorCategory>(`${base(eventId)}/matches/${String(matchId)}/slots`, {
        ...(slotAId !== undefined ? { slotAId } : {}),
        ...(slotBId !== undefined ? { slotBId } : {}),
      }),
    { success: "Atletas trocados de lugar.", failure: "Não foi possível trocar os atletas." },
  );
}

export function useStartMatch(eventId: number) {
  return useOperatorMutation(
    eventId,
    (matchId: number) => api.post<OperatorCategory>(`${base(eventId)}/matches/${String(matchId)}/start`),
    { success: "Luta iniciada.", failure: "Não foi possível iniciar a luta." },
  );
}

export function useRecordResult(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ matchId, body }: { matchId: number; body: ResultPayload }) =>
      api.post<OperatorCategory>(`${base(eventId)}/matches/${String(matchId)}/result`, body),
    { failure: "Não foi possível salvar o resultado." },
  );
}

export function useUndoMatch(eventId: number) {
  return useOperatorMutation(
    eventId,
    (matchId: number) => api.post<OperatorCategory>(`${base(eventId)}/matches/${String(matchId)}/undo`),
    { success: "Luta desfeita.", failure: "Não foi possível desfazer a luta." },
  );
}

export function useUpdateMatch(eventId: number) {
  return useOperatorMutation(
    eventId,
    ({ matchId, data }: { matchId: number; data: MatchSchedulePayload }) =>
      api.patch<OperatorCategory>(`${base(eventId)}/matches/${String(matchId)}`, data),
    { success: "Tatame e ordem salvos.", failure: "Não foi possível salvar o tatame e a ordem." },
  );
}
