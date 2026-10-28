import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { feedKeys, useDeletePost, type FeedAuthor, type FeedMedia, type FeedPost, type FeedVisibility } from "@/lib/feed";

/* ---------------------------------------------------------------------------------------------
 * Stories (linha no topo da Home). Contrato `docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md` seção 9:
 * story = `FeedPost` com `kind=STORY` (foto + legenda <= 140), vigente por 24 h, sem reação nem comentário.
 * Nada daqui vai para localStorage: o rascunho do criador vive só em memória do componente.
 * ------------------------------------------------------------------------------------------- */

export const STORY_CAPTION_MAX = 140;
/** Tempo de cada foto no visualizador antes de avançar sozinho. */
export const STORY_DURATION_MS = 5000;

export type StoryStatus = "PUBLISHED" | "PENDING_APPROVAL";

export interface StoryItem {
  id: number;
  media: FeedMedia;
  caption: string | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  status: StoryStatus;
}

export interface StoryGroup {
  /** `null` quando o autor foi anonimizado (pedido de exclusão LGPD). */
  author: FeedAuthor | null;
  isMine: boolean;
  hasUnseen: boolean;
  /** Do mais antigo para o mais novo. */
  items: StoryItem[];
}

export interface StoriesResponse {
  groups: StoryGroup[];
}

export interface CreateStoryInput {
  mediaId: number;
  caption?: string;
  visibility: FeedVisibility;
  unitId?: number;
  classId?: number;
}

/* ---------- Funções puras (testáveis) ---------- */

/** Chave estável do grupo (a ordem muda quando os stories são vistos, o autor não). */
export function storyGroupKey(group: StoryGroup): string {
  if (group.isMine) return "mine";
  if (group.author) return `u${group.author.userId}`;
  return `a${group.items[0]?.id ?? 0}`;
}

/**
 * Ordem da linha: meu grupo primeiro, depois autores com stories não vistos, depois os já vistos. Dentro de cada faixa
 * vale a ordem do servidor (mais recente primeiro). O backend já manda assim; refazer aqui protege contra a ordem local
 * mudar (story marcado como visto) e contra mocks fora de ordem.
 */
export function orderStoryGroups(groups: StoryGroup[]): StoryGroup[] {
  const rank = (group: StoryGroup) => (group.isMine ? 0 : group.hasUnseen ? 1 : 2);
  return groups
    .filter((group) => group.items.length > 0)
    .map((group, index) => ({ group, index }))
    .sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index)
    .map(({ group }) => group);
}

/** Posição do primeiro story não visto (o visualizador começa ali); sem pendência começa no primeiro. */
export function firstUnseenIndex(group: StoryGroup): number {
  const index = group.items.findIndex((item) => !item.seen);
  return index >= 0 ? index : 0;
}

/** `true` quando todos os meus stories ainda esperam aprovação (o cartão "Seu story" mostra o aviso). */
export function allPending(group: StoryGroup | undefined): boolean {
  return !!group && group.items.length > 0 && group.items.every((item) => item.status === "PENDING_APPROVAL");
}

/* ---------- Cache helpers ---------- */

function patchStories(queryClient: QueryClient, update: (groups: StoryGroup[]) => StoryGroup[]): void {
  queryClient.setQueriesData<StoriesResponse>({ queryKey: feedKeys.stories }, (data) =>
    data ? { ...data, groups: update(data.groups) } : data,
  );
}

/** Marca o story como visto no cache (o anel vira cinza na hora; o servidor recebe o `/view` à parte). */
export function markStorySeenInCache(queryClient: QueryClient, storyId: number): void {
  patchStories(queryClient, (groups) =>
    groups.map((group) => {
      if (!group.items.some((item) => item.id === storyId)) return group;
      const items = group.items.map((item) => (item.id === storyId ? { ...item, seen: true } : item));
      return { ...group, items, hasUnseen: items.some((item) => !item.seen) };
    }),
  );
}

/** Tira o story do cache (apagado); grupo sem itens some. */
export function removeStoryFromCache(queryClient: QueryClient, storyId: number): void {
  patchStories(queryClient, (groups) =>
    groups
      .map((group) => {
        if (!group.items.some((item) => item.id === storyId)) return group;
        const items = group.items.filter((item) => item.id !== storyId);
        return { ...group, items, hasUnseen: items.some((item) => !item.seen) };
      })
      .filter((group) => group.items.length > 0),
  );
}

/* ---------- Hooks ---------- */

/**
 * Stories vigentes visíveis a mim. `enabled` = só com o feed ligado. `staleTime` curto + refetch ao voltar à aba, porque
 * os stories vencem e chegam novos o dia todo. Erro = a linha se esconde (sem mensagem).
 */
export function useStories(enabled = true) {
  return useQuery({
    queryKey: feedKeys.stories,
    enabled,
    queryFn: () => api.get<StoriesResponse>("/feed/stories"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Publica um story (a foto já foi enviada por `useUploadFeedMedia`). Depois da resposta a linha é recarregada. */
export function useCreateStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStoryInput) => api.post<FeedPost>("/feed/stories", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedKeys.stories }),
  });
}

/**
 * Avisa o servidor que vi o story (POST /feed/stories/:id/view, 204 idempotente) e já atualiza o anel. Fire-and-forget:
 * falha de rede não incomoda ninguém (o story só fica "não visto" no servidor até a próxima vez).
 */
export function useMarkStoryViewed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storyId: number) => api.post<void>(`/feed/stories/${storyId}/view`),
    onMutate: (storyId) => markStorySeenInCache(queryClient, storyId),
    onError: () => undefined,
  });
}

/** Apagar story = apagar o post (`DELETE /feed/posts/:id`, mesma regra do autor/moderador). */
export const useDeleteStory = useDeletePost;
