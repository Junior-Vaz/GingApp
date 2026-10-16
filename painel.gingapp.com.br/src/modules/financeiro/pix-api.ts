import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { redirectTo } from "@/lib/redirect";
import { BILLING_KEY, finance } from "./finance-api";
import { mpCredentialsErrorMessage, type MercadoPagoCredentialsInput, type MercadoPagoStatus, type PixCharge } from "./pix";

/** Polling leve do Pix aberto: a cada 5 s por até 3 min (depois disso o usuário pode "Verificar agora"). */
export const PIX_POLL_MS = 5_000;
export const PIX_POLL_MAX_MS = 3 * 60_000;

export const MP_STATUS_KEY = ["payments", "mercadopago", "status"] as const;
const pixKey = (recordId: number) => ["finance-pix", recordId] as const;

/** Estado da conexão do grupo com o Mercado Pago (só o MESTRE chama). */
export function useMercadoPagoStatus(enabled = true) {
  return useQuery({
    queryKey: MP_STATUS_KEY,
    queryFn: () => api.get<MercadoPagoStatus>("/payments/mercadopago/status"),
    enabled,
  });
}

/** Conectar por autorização (opcional) = pedir a URL do OAuth e levar o navegador inteiro até ela; desconectar = DELETE + refaz o estado. */
export function useMercadoPagoActions() {
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: () => api.post<{ url: string }>("/payments/mercadopago/connect"),
    onSuccess: ({ url }) => redirectTo(url),
    onError: (error) => notifyError(error, "Não foi possível iniciar a conexão com o Mercado Pago."),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete<MercadoPagoStatus | undefined>("/payments/mercadopago/disconnect"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MP_STATUS_KEY });
      toast.success("Mercado Pago desconectado.");
    },
    onError: (error) => toast.error(mpCredentialsErrorMessage(error, "Não foi possível desconectar o Mercado Pago.")),
  });
  return { connect, disconnect };
}

/**
 * PUT /payments/mercadopago/credentials: o Mestre cola as credenciais da PRÓPRIA conta. Devolve o novo estado, que
 * já alimenta o cache. Sem retenção (`gcTime: 0`): o token não fica guardado no estado da mutação; os erros são
 * tratados no formulário (mensagem amigável, nunca o texto do servidor).
 */
export function useSaveMercadoPagoCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (input: MercadoPagoCredentialsInput) => api.put<MercadoPagoStatus | undefined>("/payments/mercadopago/credentials", input),
    onSuccess: (status) => {
      if (status && typeof status === "object" && "status" in status) queryClient.setQueryData(MP_STATUS_KEY, status);
      else void queryClient.invalidateQueries({ queryKey: MP_STATUS_KEY });
    },
  });
}

/** Lista, totais e inadimplentes refeitos (o Pix pago muda tudo isso). */
export function useRefreshFinance() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: finance.rootKey });
    void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
  }, [queryClient]);
}

/** POST /finance/:id/pix (idempotente: reaproveita o Pix pendente). O resultado já alimenta o cache do polling. */
export function useGeneratePix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recordId: number) => api.post<PixCharge>(`/finance/${recordId}/pix`),
    onSuccess: (charge, recordId) => queryClient.setQueryData(pixKey(recordId), charge),
    // O erro é mostrado dentro do diálogo (mensagem amigável por código), não em toast.
  });
}

/**
 * GET /finance/:id/pix a cada `intervalMs` enquanto o Pix estiver PENDING, por no máximo `maxMs`.
 * O TanStack pausa o intervalo com a aba oculta (refetchIntervalInBackground = false) e `refetchOnWindowFocus: "always"`
 * confere assim que o usuário volta - ex.: voltou do app do banco.
 */
export function usePixPolling(recordId: number | null, enabled: boolean, intervalMs = PIX_POLL_MS, maxMs = PIX_POLL_MAX_MS) {
  const startedAt = useStartedAt(recordId, enabled);
  return useQuery({
    queryKey: pixKey(recordId ?? 0),
    queryFn: () => api.get<PixCharge>(`/finance/${recordId}/pix`),
    enabled: enabled && recordId !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      query.state.data?.status === "PENDING" && Date.now() - startedAt() < maxMs ? intervalMs : false,
  });
}

/** Instante em que o polling deste Pix começou (reinicia ao trocar de lançamento ou ao reabrir). */
function useStartedAt(recordId: number | null, enabled: boolean): () => number {
  const ref = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  const key = `${recordId ?? ""}:${enabled ? 1 : 0}`;
  if (ref.current.key !== key) ref.current = { key, at: Date.now() };
  return () => ref.current.at;
}
