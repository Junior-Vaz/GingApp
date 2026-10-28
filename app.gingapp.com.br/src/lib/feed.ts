import { createContext, useCallback, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { API_URL, ApiError, api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { withQuery } from "@/lib/queries";
import { validateImageFile } from "@/lib/uploads";

/* ---------------------------------------------------------------------------------------------
 * Feed do grupo (aba "Grupo"). Tipos = contrato `docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md`
 * seção 4. Nada daqui vai para localStorage: rascunhos vivem só em memória dos componentes.
 * ------------------------------------------------------------------------------------------- */

export const FEED_PAGE_SIZE = 15;
export const FEED_BODY_MAX = 2000;
export const FEED_MAX_PHOTOS = 6;
export const COMMENT_MAX = 500;
export const REPORT_NOTE_MAX = 300;
export const COMMENTS_PAGE_SIZE = 20;
export const RECENT_COMMENTS_MAX = 2;

export type ReactionType = "AXE" | "SALVE" | "GINGA" | "PARABENS" | "CORACAO";

/** As 5 reações temáticas, na ordem do contrato (a primeira é a do botão principal). */
export const REACTIONS: readonly { type: ReactionType; label: string; emoji: string }[] = [
  { type: "AXE", label: "Axé", emoji: "🔥" },
  { type: "SALVE", label: "Salve", emoji: "👏" },
  { type: "GINGA", label: "Ginga", emoji: "🥋" },
  { type: "PARABENS", label: "Parabéns", emoji: "🎉" },
  { type: "CORACAO", label: "Coração", emoji: "❤️" },
];

export const reactionInfo = (type: ReactionType) => REACTIONS.find((item) => item.type === type) ?? REACTIONS[0]!;

export type FeedVisibility = "GROUP" | "UNIT" | "CLASS";
export type FeedPostStatus = "PUBLISHED" | "PENDING_APPROVAL" | "HIDDEN" | "REMOVED";
export type FeedPostingMode = "ALL" | "STAFF_ONLY" | "MODERATED";
export type ReportReason = "OFENSIVO" | "IMPROPRIO" | "SPAM" | "MENOR" | "OUTRO";

export interface FeedAuthor {
  userId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  roleLabel: string | null;
}

export interface FeedMedia {
  id: number;
  /** Caminho assinado `/api/feed/media/<id>?e=..&s=..` (expira em 6 h). */
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface ReactionSummary {
  counts: Record<ReactionType, number>;
  total: number;
  mine: ReactionType | null;
}

export interface FeedPost {
  id: number;
  type: "POST";
  /** Contrato seção 9: stories são `FeedPost` com `kind:'STORY'` (só aparecem em /feed/stories e na moderação). */
  kind: "POST" | "STORY";
  /** Só stories (vencem em 24 h). */
  expiresAt: string | null;
  /** `null` quando o autor foi anonimizado (pedido de exclusão LGPD). */
  author: FeedAuthor | null;
  body: string | null;
  media: FeedMedia[];
  visibility: FeedVisibility;
  unitId: number | null;
  classId: number | null;
  pinned: boolean;
  status: FeedPostStatus;
  createdAt: string;
  edited: boolean;
  reactions: ReactionSummary;
  commentsCount: number;
  /**
   * Até 2 comentários de 1º nível mais recentes, em ordem cronológica (o último é o mais novo), para o cartão estilo
   * Instagram. AUSENTE no backend antigo: quem lê trata como `[]` (`recentCommentsOf`). `commentsCount` continua valendo.
   */
  recentComments?: FeedRecentComment[];
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
}

/** Comentário resumido embutido no post (`FeedPost.recentComments`): igual ao `FeedComment`, sem `canDelete`. */
export interface FeedRecentComment {
  id: number;
  parentId: null;
  author: FeedAuthor | null;
  body: string;
  createdAt: string;
}

export interface FeedPage {
  items: FeedPost[];
  nextCursor: string | null;
}

export interface FeedSettings {
  enabled: boolean;
  postingMode: FeedPostingMode;
  canPost: boolean;
  allowComments: boolean;
  /** Para MIM: meus posts ficam aguardando aprovação. */
  requiresApproval: boolean;
}

export interface FeedComment {
  id: number;
  parentId: number | null;
  author: FeedAuthor | null;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

export interface CommentsPage {
  items: FeedComment[];
  nextCursor: string | null;
}

export interface FeedMediaUpload {
  mediaId: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface CreatePostInput {
  body?: string;
  mediaIds?: number[];
  visibility: FeedVisibility;
  unitId?: number;
  classId?: number;
}

export const FEED_PREVIEW_SIZE = 3;

export const feedKeys = {
  settings: ["feed", "settings"] as const,
  list: ["feed", "list"] as const,
  /** Prévia da Home (`GET /feed?limit=3`, uma página só); as mutações do feed também a atualizam. */
  preview: ["feed", "preview"] as const,
  /** Linha de stories da Home (`GET /feed/stories`). */
  stories: ["feed", "stories"] as const,
  comments: (postId: number) => ["feed", "comments", postId] as const,
};

/* ---------- Funções puras (testáveis) ---------- */

/** Mensagem amigável (pt-BR) para os erros de negócio do feed; o resto cai na mensagem do servidor/fallback. */
export function feedErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "FEED_DISABLED":
        return "O feed deste grupo está desligado no momento.";
      case "POSTING_NOT_ALLOWED":
        return "Você não tem permissão para publicar neste grupo.";
      case "POST_LIMIT":
        return "Você atingiu o limite de publicações de hoje. Tente de novo amanhã.";
      case "COMMENTS_DISABLED":
        return "Os comentários estão desligados neste grupo.";
      case "COMMENT_LIMIT":
        return "Você atingiu o limite de comentários de hoje. Tente de novo amanhã.";
      case "FILE_TOO_LARGE":
        return "A foto passa de 5 MB. Escolha uma menor.";
      case "FILE_TYPE_NOT_ALLOWED":
        return "Formato não aceito. Envie fotos JPEG, PNG ou WebP.";
      case "MEDIA_INVALID":
        return "Alguma foto expirou ou não é válida. Envie as fotos de novo.";
      case "MEDIA_LIMIT":
        return "Você enviou muitas fotos hoje. Tente de novo mais tarde.";
      case "STORY_LIMIT":
        return "Você atingiu o limite de stories de hoje. Tente de novo amanhã.";
      case "MEDIA_PROCESSING_UNAVAILABLE":
        return "Não foi possível processar a foto agora. Tente de novo em instantes.";
      case "VISIBILITY_NOT_ALLOWED":
        return "Você não pode publicar para esse público. Escolha outro.";
      case "INVALID_STATE":
        return "Esta publicação mudou enquanto você mexia nela. Atualize e tente de novo.";
      case "NOT_FOUND":
        return "Este conteúdo não está mais disponível. Atualize o feed.";
      default:
        break;
    }
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um pouco e tente de novo.";
    if (error.status === 413) return "A foto passa de 5 MB. Escolha uma menor.";
    if (error.status === 415) return "Formato não aceito. Envie fotos JPEG, PNG ou WebP.";
    return error.message || fallback;
  }
  // fetch() rejeita com TypeError quando não há rede.
  if (error instanceof TypeError) return "Sem conexão. Verifique sua internet e tente de novo.";
  return fallback;
}

/** Valida a foto no cliente antes de gastar rede (mesmas regras do servidor: JPEG/PNG/WebP até 5 MB). HEIC tem mensagem própria. */
export function validateFeedPhoto(file: File): string | null {
  const name = file.name.toLowerCase();
  if (/image\/hei[cf]/.test(file.type) || /\.hei[cf]$/.test(name)) {
    return "Fotos em HEIC (iPhone) ainda não são aceitas. Escolha uma foto em JPEG, PNG ou WebP.";
  }
  return validateImageFile(file);
}

/** Caminho assinado de mídia (`/api/feed/media/...`) -> `src` do <img>; em dev a API fica em outra origem. */
export function feedMediaSrc(path: string): string {
  if (!path.startsWith("/api/")) return path;
  const origin = API_URL.replace(/\/api\/?$/, "");
  return `${origin}${path}`;
}

/** "há 5 minutos"; relógio adiantado/segundos viram "agora". */
export function feedTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 45_000) return "agora";
  return relativeTime(iso);
}

export type BodyPart = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}»”’]+$/;

/**
 * Quebra o texto do post em trechos de texto puro e links http(s). NUNCA gera HTML: quem renderiza usa
 * <a rel="noopener noreferrer nofollow"> só para os trechos `link` (e o texto é sempre escapado pelo React).
 */
export function linkify(text: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = url.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    if (trailing) url = url.slice(0, url.length - trailing.length);
    let valid = false;
    try {
      const parsed = new URL(url);
      valid = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      valid = false;
    }
    if (!valid) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "link", value: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** Soma o efeito de trocar a minha reação (otimista): `type` null remove. Não muda `counts` abaixo de zero. */
export function applyReaction(summary: ReactionSummary, type: ReactionType | null): ReactionSummary {
  if (summary.mine === type) return summary;
  const counts = { ...summary.counts };
  if (summary.mine) counts[summary.mine] = Math.max(0, counts[summary.mine] - 1);
  if (type) counts[type] = (counts[type] ?? 0) + 1;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { counts, total, mine: type };
}

/** Nome mostrado no cartão: "Nome (apelido)". Autor anonimizado = "Ex-integrante". */
export function authorLabel(author: FeedAuthor | null): string {
  if (!author) return "Ex-integrante";
  return author.nickname && author.nickname !== author.name ? `${author.name} (${author.nickname})` : author.name;
}

/** Nome curto (apelido, senão o nome) para "nome + legenda" e para os comentários recentes. */
export function shortAuthorName(author: FeedAuthor | null): string {
  if (!author) return "Ex-integrante";
  return author.nickname?.trim() || author.name;
}

/** Comentários recentes do post; campo ausente (backend antigo) ou inválido = `[]`. No máximo 2, nunca respostas. */
export function recentCommentsOf(post: FeedPost | { recentComments?: FeedRecentComment[] | undefined; [key: string]: unknown }): FeedRecentComment[] {
  const list = post.recentComments;
  if (!Array.isArray(list)) return [];
  return list.filter((comment) => comment && typeof comment.id === "number" && comment.parentId == null).slice(-RECENT_COMMENTS_MAX);
}

/** Acrescenta um comentário novo ao FIM dos recentes (mantém só os 2 últimos). Resposta (parentId) não entra. */
export function appendRecentComment(post: FeedPost, comment: Pick<FeedComment, "id" | "parentId" | "author" | "body" | "createdAt">): FeedRecentComment[] {
  const current = recentCommentsOf(post);
  if (comment.parentId !== null) return current;
  const next: FeedRecentComment = { id: comment.id, parentId: null, author: comment.author, body: comment.body, createdAt: comment.createdAt };
  return [...current.filter((item) => item.id !== comment.id), next].slice(-RECENT_COMMENTS_MAX);
}

/* ---------- Cache helpers ---------- */

type FeedInfinite = InfiniteData<FeedPage, string | null>;

function patchPage(page: FeedPage, postId: number, update: (post: FeedPost) => FeedPost | null): FeedPage {
  return {
    ...page,
    items: page.items.flatMap((post) => {
      if (post.id !== postId) return [post];
      const next = update(post);
      return next ? [next] : [];
    }),
  };
}

function insertIntoPage(page: FeedPage, post: FeedPost): FeedPage {
  const withoutDuplicate = page.items.filter((item) => item.id !== post.id);
  let index = 0;
  while (index < withoutDuplicate.length && withoutDuplicate[index]?.pinned) index += 1;
  return { ...page, items: [...withoutDuplicate.slice(0, index), post, ...withoutDuplicate.slice(index)] };
}

/**
 * Aplica `update` ao post em todas as listas do feed em cache (a lista infinita E a prévia da Home);
 * devolver `null` remove o post.
 */
export function patchPostInCache(queryClient: QueryClient, postId: number, update: (post: FeedPost) => FeedPost | null): void {
  queryClient.setQueriesData<FeedInfinite>({ queryKey: feedKeys.list }, (data) => {
    if (!data) return data;
    return { ...data, pages: data.pages.map((page) => patchPage(page, postId, update)) };
  });
  queryClient.setQueriesData<FeedPage>({ queryKey: feedKeys.preview }, (data) => (data ? patchPage(data, postId, update) : data));
}

/** Põe um post recém-criado no topo da primeira página (depois dos fixados), na lista e na prévia da Home. */
export function insertPostInCache(queryClient: QueryClient, post: FeedPost): void {
  queryClient.setQueriesData<FeedInfinite>({ queryKey: feedKeys.list }, (data) => {
    if (!data || data.pages.length === 0) return data;
    const [first, ...rest] = data.pages;
    if (!first) return data;
    return { ...data, pages: [insertIntoPage(first, post), ...rest] };
  });
  queryClient.setQueriesData<FeedPage>({ queryKey: feedKeys.preview }, (data) => (data ? insertIntoPage(data, post) : data));
}

/**
 * `url`/`thumbUrl` expiram em 6 h: se uma imagem falhar ao carregar, a galeria avisa por aqui e a página do feed
 * refaz o fetch da lista UMA vez por foto (URLs novas, assinatura nova). Sem provider = não faz nada.
 */
export const MediaErrorContext = createContext<(mediaId: number) => void>(() => {});

/* ---------- Hooks ---------- */

export function useFeedSettings() {
  return useQuery({
    queryKey: feedKeys.settings,
    queryFn: () => api.get<FeedSettings>("/feed/settings"),
    staleTime: 60_000,
    retry: false,
  });
}

/** Lista infinita por cursor. `enabled` = só depois de saber que o feed está ligado. */
export function useFeed(enabled = true) {
  const query = useInfiniteQuery({
    queryKey: feedKeys.list,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<FeedPage>(withQuery("/feed", { limit: FEED_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<number>();
    const list: FeedPost[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const post of page.items) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        list.push(post);
      }
    }
    return list;
  }, [query.data]);
  return { ...query, items };
}

/**
 * Prévia da Home: os posts mais recentes (`GET /feed?limit=3`, sem cursor) numa query PRÓPRIA (não reaproveita a lista
 * infinita, que tem 15 por página). `enabled` = só com o feed ligado. Stories nunca entram (o backend já os separa;
 * o filtro é só defesa).
 */
export function useFeedPreview(enabled = true) {
  const query = useQuery({
    queryKey: feedKeys.preview,
    enabled,
    queryFn: () => api.get<FeedPage>(withQuery("/feed", { limit: FEED_PREVIEW_SIZE })),
    staleTime: 30_000,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<number>();
    const list: FeedPost[] = [];
    for (const post of query.data?.items ?? []) {
      if (post.kind === "STORY" || seen.has(post.id)) continue;
      seen.add(post.id);
      list.push(post);
    }
    return list.slice(0, FEED_PREVIEW_SIZE);
  }, [query.data]);
  return { ...query, items };
}

/**
 * `url`/`thumbUrl` assinadas expiram em 6 h: devolve um `onError` por mídia que refaz as queries dadas UMA vez por
 * mídia (e uma recarga por vez). Mesmo comportamento da página do feed.
 */
export function useMediaErrorRefetch(queryKeys: readonly (readonly unknown[])[]): (mediaId: number) => void {
  const queryClient = useQueryClient();
  const retried = useRef(new Set<number>());
  const reloading = useRef(false);
  const keys = useRef(queryKeys);
  keys.current = queryKeys;
  return useCallback(
    (mediaId: number) => {
      if (retried.current.has(mediaId)) return;
      retried.current.add(mediaId);
      if (reloading.current) return;
      reloading.current = true;
      void Promise.all(keys.current.map((queryKey) => queryClient.refetchQueries({ queryKey }))).finally(() => {
        reloading.current = false;
      });
    },
    [queryClient],
  );
}

export function useUploadFeedMedia() {
  return useMutation({
    // Multipart; o fetch não expõe progresso de upload, então a tela mostra estado "enviando" indeterminado.
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<FeedMediaUpload>("/feed/media", form);
    },
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePostInput) => api.post<FeedPost>("/feed/posts", input),
    onSuccess: (post) => {
      // Aprovado direto ou pendente (visível só para o autor): em ambos aparece no topo.
      if (post && typeof post.id === "number") insertPostInCache(queryClient, post);
    },
  });
}

export function useEditPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: string }) =>
      api.patch<FeedPost | undefined>(`/feed/posts/${postId}`, { body }),
    onSuccess: (response, { postId, body }) => {
      patchPostInCache(queryClient, postId, (post) => ({
        ...post,
        body,
        edited: true,
        ...(response && typeof response === "object" && "id" in response ? response : {}),
      }));
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: number) => api.delete<void>(`/feed/posts/${postId}`),
    onSuccess: (_data, postId) => {
      patchPostInCache(queryClient, postId, () => null);
      // A prévia da Home perdeu um item (volta a ter 3) e, se era um story, a linha de stories também muda.
      void queryClient.invalidateQueries({ queryKey: feedKeys.preview });
      void queryClient.invalidateQueries({ queryKey: feedKeys.stories });
    },
  });
}

/** Reação com atualização otimista e rollback; chamadas do mesmo post são serializadas (`scope`). */
export function useReact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["feed", "react"],
    scope: { id: "feed-react" },
    mutationFn: ({ postId, type }: { postId: number; type: ReactionType | null }) =>
      api.put<ReactionSummary>(`/feed/posts/${postId}/reaction`, { type }),
    onMutate: async ({ postId, type }) => {
      await queryClient.cancelQueries({ queryKey: feedKeys.list });
      await queryClient.cancelQueries({ queryKey: feedKeys.preview });
      const seen: { previous: ReactionSummary | null } = { previous: null };
      patchPostInCache(queryClient, postId, (post) => {
        seen.previous ??= post.reactions;
        return { ...post, reactions: applyReaction(post.reactions, type) };
      });
      return { previous: seen.previous };
    },
    onError: (_error, { postId }, context) => {
      const previous = context?.previous;
      if (previous) patchPostInCache(queryClient, postId, (post) => ({ ...post, reactions: previous }));
    },
    onSuccess: (summary, { postId }) => {
      // Outra reação na fila: o otimista dela vale mais que esta resposta já velha.
      if (queryClient.isMutating({ mutationKey: ["feed", "react"] }) > 1) return;
      if (summary && typeof summary === "object" && "counts" in summary) {
        patchPostInCache(queryClient, postId, (post) => ({ ...post, reactions: summary }));
      }
    },
  });
}

export function useComments(postId: number, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: feedKeys.comments(postId),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<CommentsPage>(
        withQuery(`/feed/posts/${postId}/comments`, { limit: COMMENTS_PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = useMemo(() => {
    const seen = new Set<number>();
    const list: FeedComment[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const comment of page.items) {
        if (seen.has(comment.id)) continue;
        seen.add(comment.id);
        list.push(comment);
      }
    }
    return list;
  }, [query.data]);
  return { ...query, items };
}

export function useAddComment(postId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; parentId?: number }) =>
      api.post<FeedComment>(`/feed/posts/${postId}/comments`, input),
    onSuccess: async (created) => {
      // O comentário novo passa a ser o ÚLTIMO dos recentes do post (lista e prévia da Home); respostas só contam no total.
      const valid = created && typeof created === "object" && typeof created.id === "number";
      patchPostInCache(queryClient, postId, (post) => ({
        ...post,
        commentsCount: post.commentsCount + 1,
        ...(valid ? { recentComments: appendRecentComment(post, created) } : {}),
      }));
      await queryClient.invalidateQueries({ queryKey: feedKeys.comments(postId) });
    },
  });
}

/** `removedCount` = o comentário + as respostas dele que estavam na tela (para o contador do post). */
export function useDeleteComment(postId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId }: { commentId: number; removedCount: number }) =>
      api.delete<void>(`/feed/comments/${commentId}`),
    onSuccess: async (_data, { commentId, removedCount }) => {
      patchPostInCache(queryClient, postId, (post) => ({
        ...post,
        commentsCount: Math.max(0, post.commentsCount - removedCount),
        ...(post.recentComments ? { recentComments: recentCommentsOf(post).filter((item) => item.id !== commentId) } : {}),
      }));
      // Os recentes podem ter ficado com menos de 2: a prévia (pequena) busca de novo; a lista só fica marcada como velha.
      void queryClient.invalidateQueries({ queryKey: feedKeys.preview });
      void queryClient.invalidateQueries({ queryKey: feedKeys.list, refetchType: "none" });
      await queryClient.invalidateQueries({ queryKey: feedKeys.comments(postId) });
    },
  });
}

export function useReport() {
  return useMutation({
    mutationFn: ({ kind, id, reason, note }: { kind: "post" | "comment"; id: number; reason: ReportReason; note?: string }) =>
      api.post<{ ok: boolean }>(`/feed/${kind === "post" ? "posts" : "comments"}/${id}/report`, {
        reason,
        ...(note ? { note } : {}),
      }),
  });
}
