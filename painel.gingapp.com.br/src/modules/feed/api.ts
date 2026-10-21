import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { API_URL, ApiError, api, errorMessage } from "@/lib/api";
import type { FeedSettings, QueueItem, QueueKind, QueuePage } from "./types";

const ROOT = ["feed"] as const;

export const feedKeys = {
  queueRoot: [...ROOT, "queue"] as const,
  queue: (kind: QueueKind) => [...ROOT, "queue", kind] as const,
  settingsAdmin: () => [...ROOT, "settings", "admin"] as const,
};

export const QUEUE_PAGE_SIZE = 15;

// ---------------------------------------------------------------- mensagens

/** Mensagem amigável por status HTTP (403/404/429/rede) e, por fim, a do servidor ou o texto de reserva. */
export function feedErrorMessage(error: unknown, fallback = "Algo deu errado. Tente novamente."): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Você não tem permissão para fazer isso no feed deste grupo.";
    if (error.status === 404)
      return "Esta publicação não existe mais (talvez outro moderador já tenha decidido). A lista foi atualizada.";
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, fallback);
}

// ------------------------------------------------------------------- mídia

/**
 * `url`/`thumbUrl` do feed são caminhos assinados `/api/feed/media/...` (sem Authorization: <img> não envia cabeçalho).
 * Em produção painel e API dividem o domínio; em desenvolvimento (API em outra porta) o caminho ganha a origem da API.
 * Qualquer outra coisa (ex.: `javascript:`) vira "" e a imagem nem é renderizada.
 */
export function mediaSrc(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/api/feed/media/")) return `${API_URL.replace(/\/api\/?$/, "")}${path}`;
  return "";
}

// ------------------------------------------------------------------- fila

type QueueData = InfiniteData<QueuePage, string | undefined>;

/** Fila de moderação de um tipo, paginada por cursor (`GET /feed/moderation/queue`). */
export function useQueue(kind: QueueKind) {
  return useInfiniteQuery({
    queryKey: feedKeys.queue(kind),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({ kind, limit: String(QUEUE_PAGE_SIZE) });
      if (pageParam) search.set("cursor", pageParam);
      return api.get<QueuePage>(`/feed/moderation/queue?${search.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Itens já carregados de todas as páginas. */
export function flattenQueue(data: { pages: QueuePage[] } | undefined): QueueItem[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/** Identidade de um item da fila: o comentário denunciado tem identidade própria (o mesmo post pode aparecer 2 vezes). */
export const itemKey = (item: QueueItem): string =>
  item.comment ? `c-${String(item.comment.id)}` : `p-${String(item.post.id)}`;

export type ModAction =
  | "approve"
  | "hide"
  | "restore"
  | "pin"
  | "unpin"
  | "remove"
  | "dismiss"
  | "resolveHide"
  | "resolveRemove"
  | "removeComment"
  | "dismissComment";

const DONE: Record<ModAction, string> = {
  approve: "Publicação aprovada.",
  hide: "Publicação ocultada.",
  restore: "Publicação restaurada.",
  pin: "Publicação fixada no topo.",
  unpin: "Publicação desafixada.",
  remove: "Publicação removida.",
  dismiss: "Denúncias ignoradas. A publicação foi mantida.",
  resolveHide: "Publicação ocultada.",
  resolveRemove: "Publicação removida.",
  removeComment: "Comentário removido.",
  dismissComment: "Denúncias ignoradas. O comentário foi mantido.",
};

function send(action: ModAction, item: QueueItem): Promise<unknown> {
  const id = encodeURIComponent(String(item.post.id));
  switch (action) {
    case "approve":
    case "hide":
    case "restore":
    case "pin":
    case "unpin":
      return api.post(`/feed/posts/${id}/${action}`);
    case "remove":
      return api.delete(`/feed/posts/${id}`);
    case "dismiss":
      return api.post(`/feed/moderation/reports/${id}/resolve`, { action: "DISMISS" });
    case "resolveHide":
      return api.post(`/feed/moderation/reports/${id}/resolve`, { action: "HIDE" });
    case "resolveRemove":
      return api.post(`/feed/moderation/reports/${id}/resolve`, { action: "REMOVE" });
    case "removeComment":
      return api.delete(`/feed/comments/${encodeURIComponent(String(item.comment?.id))}`);
    case "dismissComment":
      // Extensão do backend: `commentId` no corpo do resolve decide as denúncias DO COMENTÁRIO (devolve ao feed o que o
      // limite de 3 denúncias ocultou). Resposta 200 `{ ok: true }`.
      return api.post(`/feed/moderation/reports/${id}/resolve`, { action: "DISMISS", commentId: item.comment?.id });
  }
}

function patchQueue(client: QueryClient, key: readonly unknown[], fn: (items: QueueItem[]) => QueueItem[]) {
  client.setQueriesData<QueueData>({ queryKey: key }, (old) =>
    old ? { ...old, pages: old.pages.map((page) => ({ ...page, items: fn(page.items) })) } : old,
  );
}

/**
 * Ação de moderação com atualização otimista: o item sai da aba na hora (ou ganha/perde o selo "Fixado") e volta se o
 * servidor recusar (rollback do cache + toast). No fim, refaz as filas (o post pode ter ido parar em outra aba).
 */
export function useModerate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, item }: { action: ModAction; item: QueueItem; kind: QueueKind }) =>
      send(action, item),
    onMutate: async ({ action, item, kind }) => {
      await client.cancelQueries({ queryKey: feedKeys.queueRoot });
      const snapshot = client.getQueriesData<QueueData>({ queryKey: feedKeys.queueRoot });
      if (action === "pin" || action === "unpin") {
        patchQueue(client, feedKeys.queueRoot, (items) =>
          items.map((it) =>
            String(it.post.id) === String(item.post.id)
              ? { ...it, post: { ...it.post, pinned: action === "pin" } }
              : it,
          ),
        );
      } else {
        const key = itemKey(item);
        patchQueue(client, feedKeys.queue(kind), (items) => items.filter((it) => itemKey(it) !== key));
      }
      return { snapshot };
    },
    onError: (error, _vars, context) => {
      if (context) for (const [key, data] of context.snapshot) client.setQueryData(key, data);
      toast.error(feedErrorMessage(error, "Não foi possível concluir a ação."));
    },
    onSuccess: (_data, { action }) => toast.success(DONE[action]),
    onSettled: () => void client.invalidateQueries({ queryKey: feedKeys.queueRoot }),
  });
}

// ------------------------------------------------------------ configurações

/** `GET /feed/settings/admin` (só MESTRE): inclui as palavras bloqueadas. */
export function useFeedSettings(enabled: boolean) {
  return useQuery({
    queryKey: feedKeys.settingsAdmin(),
    queryFn: async (): Promise<FeedSettings> => {
      const data = await api.get<Partial<FeedSettings>>("/feed/settings/admin");
      return {
        enabled: data.enabled ?? true,
        postingMode: data.postingMode ?? "MODERATED",
        allowComments: data.allowComments ?? true,
        blockedWords: Array.isArray(data.blockedWords) ? data.blockedWords : [],
      };
    },
    enabled,
  });
}

/** `PUT /feed/settings` (só MESTRE): grava tudo de uma vez e põe o resultado no cache. */
export function useSaveFeedSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: FeedSettings) => api.put<unknown>("/feed/settings", payload),
    onSuccess: (_data, payload) => {
      client.setQueryData(feedKeys.settingsAdmin(), payload);
      void client.invalidateQueries({ queryKey: feedKeys.settingsAdmin() });
      toast.success("Configurações do feed salvas.");
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 403
          ? "Somente o Mestre pode alterar as configurações do feed."
          : feedErrorMessage(error, "Não foi possível salvar as configurações."),
      ),
  });
}
