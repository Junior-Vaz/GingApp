import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, API_URL } from "@/lib/api";

/* ------------------------------------------------------------------------------------------------
 * Comunicados fixados e confirmacao (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md, secao 3).
 * GET /communications/pinned e POST /communications/:id/ack. Texto sempre PURO: o corpo nunca vira HTML;
 * `linkifyText` so' reconhece http(s) e a tela monta os <a> com rel="noopener noreferrer nofollow".
 * ---------------------------------------------------------------------------------------------- */

export type AckRequirement = "NONE" | "READ" | "GOING";
export type AckResponse = "READ" | "GOING" | "NOT_GOING";

export interface PinnedCommunication {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  requiresAck: AckRequirement;
  myAck: AckResponse | null;
  pinnedUntil: string | null;
  createdAt: string;
}

export interface PinnedCommunicationsResponse {
  items: PinnedCommunication[];
}

export const PINNED_COMMUNICATIONS_KEY = ["communications", "pinned"] as const;

/** Comunicados fixados vigentes para mim. Erro (ex.: backend antigo) nao e repetido: a area some. */
export function usePinnedCommunications(enabled = true) {
  return useQuery({
    queryKey: PINNED_COMMUNICATIONS_KEY,
    queryFn: () => api.get<PinnedCommunicationsResponse>("/communications/pinned"),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export interface AckInput {
  id: number;
  response: AckResponse;
}

interface AckContext {
  previous: PinnedCommunicationsResponse | undefined;
}

/**
 * Responde a um comunicado (uma resposta por usuario; GOING <-> NOT_GOING pode trocar). Atualizacao
 * OTIMISTA do cache dos fixados: o botao muda na hora e volta atras se o servidor recusar.
 */
export function useAckCommunication() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean; response: AckResponse }, Error, AckInput, AckContext>({
    mutationFn: ({ id, response }) => api.post(`/communications/${id}/ack`, { response }),
    onMutate: async ({ id, response }) => {
      await queryClient.cancelQueries({ queryKey: PINNED_COMMUNICATIONS_KEY });
      const previous = queryClient.getQueryData<PinnedCommunicationsResponse>(PINNED_COMMUNICATIONS_KEY);
      queryClient.setQueryData<PinnedCommunicationsResponse>(PINNED_COMMUNICATIONS_KEY, (current) =>
        current ? { ...current, items: current.items.map((c) => (c.id === id ? { ...c, myAck: response } : c)) } : current,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(PINNED_COMMUNICATIONS_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PINNED_COMMUNICATIONS_KEY });
    },
  });
}

/* ------------------------------- Texto e links seguros ------------------------------- */

export type TextPart = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
/** Pontuacao que costuma vir colada ao fim de um link no texto corrido. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** So' http(s) com host: `javascript:`, `data:`, `//x` e afins nunca viram link. */
export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Quebra uma LINHA de texto em trechos de texto puro e links http(s) validos. */
export function linkifyText(line: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
    const href = safeHttpUrl(trimmed);
    if (!href) continue;
    if (start > last) parts.push({ type: "text", text: line.slice(last, start) });
    parts.push({ type: "link", text: trimmed, href });
    last = start + trimmed.length;
  }
  if (last < line.length) parts.push({ type: "text", text: line.slice(last) });
  return parts;
}

/** Imagem do comunicado: so' http(s) ou caminho da propria API (`/api/...`); nada de javascript:/data:. */
export function communicationImageSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/api/") && !value.startsWith("//")) {
    return `${API_URL.replace(/\/api\/?$/, "")}${value}`;
  }
  return safeHttpUrl(value);
}

/* -------------------------- Notificacao -> comunicado (ack) -------------------------- */

/** `data.communicationId` da notificacao (numero ou texto numerico); ausente => null. */
export function communicationIdOf(notice: { data?: Record<string, unknown> | null | undefined }): number | null {
  const raw = notice.data?.["communicationId"];
  const id = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** `data.requiresAck` da notificacao, se o backend mandar; senao undefined. */
export function notificationRequiresAck(notice: { data?: Record<string, unknown> | null | undefined }): AckRequirement | undefined {
  const raw = notice.data?.["requiresAck"];
  return raw === "NONE" || raw === "READ" || raw === "GOING" ? raw : undefined;
}
