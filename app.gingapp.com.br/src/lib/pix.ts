import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";

/**
 * Pagar a mensalidade por Pix (Mercado Pago do PRÓPRIO grupo): o aluno/responsável gera o Pix do lançamento
 * (POST /finance/me/:id/pix, idempotente), paga no app do banco e a baixa chega pelo webhook do backend.
 */

export type PixStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
export type PaidVia = "MANUAL" | "PIX_AUTO" | null;

/** Resumo do Pix mais recente do lançamento, em GET /finance/me (null = nunca gerou Pix). */
export interface PixSummary {
  status: PixStatus;
  expiresAt: string;
  generatedAt: string;
}

/** POST/GET /finance/me/:id/pix. */
export interface PixCharge {
  financeRecordId: number;
  amountCents: number;
  status: PixStatus;
  /** Pix "copia e cola". */
  qrCode: string;
  /** PNG em base64 (sem prefixo `data:`), quando o Mercado Pago envia. */
  qrCodeBase64?: string | null | undefined;
  ticketUrl?: string | null | undefined;
  expiresAt: string;
  generatedAt: string;
}

/** Polling leve do Pix aberto: a cada 5 s por até 3 min. */
export const PIX_POLL_MS = 5_000;
export const PIX_POLL_MAX_MS = 3 * 60_000;

const GROUP_NOT_RECEIVING = "O grupo ainda não está recebendo por Pix. Fale com o seu Mestre.";

/** Códigos estáveis de erro do Pix -> mensagem para o aluno/responsável (sem jargão de integração). */
const PIX_ERRORS: Record<string, string> = {
  MP_NOT_CONNECTED: GROUP_NOT_RECEIVING,
  MP_ACCOUNT_ERROR: GROUP_NOT_RECEIVING,
  RECORD_NOT_PAYABLE: "Esta cobrança não pode ser paga por Pix (está cancelada ou sem valor a pagar).",
  ALREADY_PAID: "Esta cobrança já está paga.",
  PAYER_EMAIL_REQUIRED: "Cadastre um e-mail do aluno ou responsável para gerar o Pix.",
  AMOUNT_TOO_LOW: "O valor é baixo demais para ser pago por Pix. Combine com o professor.",
  PIX_PENDING_AMOUNT_CHANGED: "Há um Pix pendente com o valor anterior; tente de novo em alguns minutos.",
  RECORD_CHANGED: "Esta cobrança foi alterada (talvez já tenha sido paga). Atualize a tela.",
  RECORD_PAID_VIA_PIX: "Esta cobrança já foi paga por Pix.",
  PROVIDER_UNAVAILABLE: "O Pix não respondeu agora. Tente de novo em instantes.",
  PROVIDER_ERROR: "Não foi possível gerar o Pix agora. Fale com o seu Mestre se o problema continuar.",
  PAYMENTS_UNAVAILABLE: "Pagamentos online não estão disponíveis no momento.",
  PIX_NOT_FOUND: "Nenhum Pix foi gerado para esta cobrança.",
};

export const pixErrorCode = (error: unknown): string | undefined => (error instanceof ApiError ? error.code : undefined);

export function pixErrorMessage(error: unknown): string {
  const code = pixErrorCode(error);
  if (code && PIX_ERRORS[code]) return PIX_ERRORS[code];
  return errorMessage(error, "Não foi possível gerar o Pix. Tente novamente.");
}

/** Imagem do QR: o PNG do Mercado Pago (com ou sem o prefixo `data:`); null = gerar a partir do copia e cola. */
export function qrImageSrc(charge: Pick<PixCharge, "qrCodeBase64">): string | null {
  const raw = charge.qrCodeBase64?.trim();
  if (!raw) return null;
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
}

export const formatPixExpiry = (iso: string): string => fmt(toDate(iso), "dd/MM/yyyy 'às' HH:mm");

export type PixBadgeKind = "waiting" | "paid-auto";
export const PIX_BADGE_LABEL: Record<PixBadgeKind, string> = {
  waiting: "Pix aguardando",
  "paid-auto": "Pago via Pix",
};

/** Selo do Pix da linha: aguardando (PENDING ainda válido, lançamento em aberto) ou pago via Pix (baixa automática). */
export function pixBadgeKind(
  record: { status: string; paidVia?: PaidVia | undefined; pix?: PixSummary | null | undefined },
  now: number = Date.now(),
): PixBadgeKind | null {
  if (record.status === "PAID") return record.paidVia === "PIX_AUTO" ? "paid-auto" : null;
  if (record.status === "CANCELLED" || record.pix?.status !== "PENDING") return null;
  return toDate(record.pix.expiresAt).getTime() < now ? null : "waiting";
}

/** Só lançamento em aberto (PENDING/OVERDUE) tem "Pagar com Pix". */
export const canPayWithPix = (status: string): boolean => status === "PENDING" || status === "OVERDUE";

const pixKey = (recordId: number) => ["finance-pix", recordId] as const;

/** POST /finance/me/:id/pix (idempotente: reaproveita o Pix pendente). O resultado já alimenta o cache do polling. */
export function useGeneratePix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recordId: number) => api.post<PixCharge>(`/finance/me/${recordId}/pix`),
    onSuccess: (charge, recordId) => queryClient.setQueryData(pixKey(recordId), charge),
    // O erro é mostrado dentro da folha (mensagem amigável por código), não em toast.
  });
}

/** Lista e resumo do "meu financeiro" refeitos (o Pix pago muda o banner e as linhas). */
export function useRefreshFinance() {
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: ["finance"] }), [queryClient]);
}

/**
 * GET /finance/me/:id/pix a cada `intervalMs` enquanto o Pix estiver PENDING, por no máximo `maxMs`. O TanStack pausa o
 * intervalo com a aba oculta e `refetchOnWindowFocus: "always"` confere assim que o usuário volta do app do banco.
 */
export function usePixPolling(recordId: number | null, enabled: boolean, intervalMs = PIX_POLL_MS, maxMs = PIX_POLL_MAX_MS) {
  const started = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  const key = `${recordId ?? ""}:${enabled ? 1 : 0}`;
  if (started.current.key !== key) started.current = { key, at: Date.now() };
  return useQuery({
    queryKey: pixKey(recordId ?? 0),
    queryFn: () => api.get<PixCharge>(`/finance/me/${recordId}/pix`),
    enabled: enabled && recordId !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      query.state.data?.status === "PENDING" && Date.now() - started.current.at < maxMs ? intervalMs : false,
  });
}
