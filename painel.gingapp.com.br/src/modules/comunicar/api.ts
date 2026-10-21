import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, buildQuery, type QueryParams } from "@/lib/api";
import type {
  CommScope,
  CommunicationDetail,
  CommunicationItem,
  CreateCommunicationInput,
  CreateCommunicationResult,
  PreviewResult,
  ResendResult,
} from "./types";
import { previewParams } from "./utils";

const ROOT = ["communications"] as const;

export const commKeys = {
  root: ROOT,
  list: (params: QueryParams) => [...ROOT, "list", params] as const,
  detail: (id: number) => [...ROOT, "detail", id] as const,
  preview: (scope: CommScope | null) => [...ROOT, "preview", scope] as const,
};

/** GET /communications?status&limit&offset (array + X-Total-Count). */
export function useCommunications(params: QueryParams) {
  const query = useQuery({
    queryKey: commKeys.list(params),
    queryFn: () => api.getPage<CommunicationItem>("/communications", params),
    placeholderData: keepPreviousData,
  });
  return {
    items: query.data?.items,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/** GET /communications/:id (corpo, alcance, confirmações e pendentes). */
export function useCommunication(id: number | null) {
  return useQuery({
    queryKey: commKeys.detail(id ?? 0),
    queryFn: () => api.get<CommunicationDetail>(`/communications/${String(id)}`),
    enabled: id !== null,
  });
}

/** GET /communications/preview: quantas pessoas recebem e uma amostra de nomes. Desligada até o alcance estar completo. */
export function usePreview(scope: CommScope | null) {
  return useQuery({
    queryKey: commKeys.preview(scope),
    queryFn: () => api.get<PreviewResult>(`/communications/preview${buildQuery(previewParams(scope!))}`),
    enabled: scope !== null,
    // A contagem é a base da confirmação ("Enviar para N pessoas?"): sempre fresca.
    staleTime: 0,
    gcTime: 0,
  });
}

/** POST /communications. Depois do envio refaz o histórico. */
export function useCreateCommunication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommunicationInput) => api.post<CreateCommunicationResult>("/communications", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...ROOT, "list"] }),
  });
}

/** POST /communications/:id/resend-unread (máx. 1 por 24 h: 429 RESEND_TOO_SOON). */
export function useResendUnread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<ResendResult | undefined>(`/communications/${String(id)}/resend-unread`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}

/** DELETE /communications/:id: cancela um agendado (409 ALREADY_SENT se já foi enviado). */
export function useCancelCommunication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<unknown>(`/communications/${String(id)}`),
    // Em sucesso OU em ALREADY_SENT a situação mudou no servidor: refaz lista e detalhe.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}
