import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { feedErrorMessage, feedKeys, MediaErrorContext, useFeed, useFeedSettings, type FeedPage as FeedPageData } from "@/lib/feed";
import { PageHeading } from "../shared";
import { BirthdaysStrip } from "../birthdays-strip";
import { PinnedCommunications } from "../pinned-communications";
import { PostCard } from "./post-card";
import { CannotPostNote, PostComposer } from "./post-composer";

const PULL_TRIGGER = 56;
const PULL_MAX = 84;

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-1 border-t border-border max-md:-mx-[18px]" aria-busy="true" aria-label="Carregando publicações" data-testid="feed-loading">
      {[0, 1, 2].map((key) => (
        <div key={key} className="border-b border-border pb-3 pt-3">
          <div className="flex items-center gap-2.5 px-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
          <Skeleton className="mt-3 aspect-[4/3] w-full rounded-none" />
          <Skeleton className="mx-3 mt-3 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="feed-error">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" className="mt-3 h-11" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

/** Página "Grupo": o feed do grupo (compositor, lista infinita, puxar para recarregar). */
export function FeedPage() {
  const queryClient = useQueryClient();
  const settings = useFeedSettings();
  const enabled = settings.data?.enabled === true;
  const feed = useFeed(enabled);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const touchStart = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  /** Volta para a 1ª página e busca de novo só ela (não refaz páginas fundas que o usuário já passou). */
  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      queryClient.setQueryData<InfiniteData<FeedPageData, string | null>>(feedKeys.list, (data) =>
        data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
      );
      const [settingsResult, listResult] = await Promise.all([settings.refetch(), enabled ? feed.refetch() : Promise.resolve(null)]);
      const failed = settingsResult.error ?? listResult?.error;
      if (failed) toast.error(feedErrorMessage(failed, "Não foi possível atualizar agora."));
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing, queryClient, enabled, settings.refetch, feed.refetch]);

  // URLs de imagem expiram em 6 h: se uma falhar, refaz a lista UMA vez por foto (e uma recarga por vez).
  const retriedMedia = useRef(new Set<number>());
  const reloadingMedia = useRef(false);
  const onMediaError = useCallback(
    (mediaId: number) => {
      if (retriedMedia.current.has(mediaId)) return;
      retriedMedia.current.add(mediaId);
      if (reloadingMedia.current) return;
      reloadingMedia.current = true;
      void queryClient.refetchQueries({ queryKey: feedKeys.list }).finally(() => {
        reloadingMedia.current = false;
      });
    },
    [queryClient],
  );

  // Rolagem infinita: o sentinela perto do fim busca a próxima página (o botão "Ver mais" cobre quem não tem o Observer).
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, feed.items.length]);

  const scrollTop = () => document.scrollingElement?.scrollTop ?? window.scrollY;
  function onTouchStart(event: TouchEvent) {
    touchStart.current = scrollTop() <= 0 && !refreshing ? (event.touches[0]?.clientY ?? null) : null;
  }
  function onTouchMove(event: TouchEvent) {
    if (touchStart.current === null) return;
    const delta = (event.touches[0]?.clientY ?? 0) - touchStart.current;
    setPull(delta > 0 ? Math.min(PULL_MAX, delta * 0.5) : 0);
  }
  function onTouchEnd() {
    const triggered = pull >= PULL_TRIGGER;
    touchStart.current = null;
    setPull(0);
    if (triggered) void refresh();
  }

  const data = settings.data;
  const items = feed.items;

  return (
    <MediaErrorContext.Provider value={onMediaError}>
      <PageHeading title="Grupo" subtitle="O que está acontecendo na roda do seu grupo." />
      <div
        className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-1 gap-4"
        data-testid="feed-page"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Topo do feed: comunicados fixados e faixa de aniversariantes da semana (cada um se esconde sozinho quando vazio). */}
        <div data-testid="feed-top-slot" className="grid grid-cols-1 gap-3 empty:hidden">
          <PinnedCommunications />
          <BirthdaysStrip />
        </div>

        {(pull > 0 || refreshing) && (
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground" style={{ height: refreshing ? 28 : pull }} role="status" data-testid="feed-pull">
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {refreshing ? "Atualizando…" : pull >= PULL_TRIGGER ? "Solte para atualizar" : "Puxe para atualizar"}
          </p>
        )}

        {settings.isLoading ? (
          <FeedSkeleton />
        ) : settings.isError || !data ? (
          <ErrorBox message={feedErrorMessage(settings.error, "Não foi possível carregar o feed do grupo.")} onRetry={() => void settings.refetch()} />
        ) : !data.enabled ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center" role="status" data-testid="feed-disabled">
            <p className="font-display text-base font-bold">O feed deste grupo está desligado</p>
            <p className="mt-1 text-sm text-muted-foreground">Quando a equipe ativar, as publicações aparecem aqui.</p>
          </div>
        ) : (
          <>
            {data.canPost ? <PostComposer settings={data} /> : <CannotPostNote settings={data} />}

            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold">Publicações</h2>
              <Button type="button" variant="ghost" size="sm" className="h-11 px-3" onClick={() => void refresh()} disabled={refreshing} aria-label="Atualizar publicações" data-testid="feed-refresh">
                <RefreshCw className={refreshing ? "animate-spin" : ""} /> Atualizar
              </Button>
            </div>

            {feed.isLoading ? (
              <FeedSkeleton />
            ) : feed.isError && items.length === 0 ? (
              <ErrorBox message={feedErrorMessage(feed.error, "Não foi possível carregar as publicações.")} onRetry={() => void feed.refetch()} />
            ) : items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center" data-testid="feed-empty">
                <p className="font-display text-base font-bold">{data.canPost ? "Seja o primeiro a postar!" : "Ainda não há publicações."}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.canPost ? "Conte como foi o treino, mostre uma foto da roda." : "Quando alguém publicar, aparece aqui."}
                </p>
              </div>
            ) : (
              <>
                {feed.isError && (
                  <p className="rounded-md bg-card px-3 py-2 text-xs text-destructive" role="alert">
                    Não foi possível atualizar agora. Mostrando o que já estava carregado.
                  </p>
                )}
                {/* Estilo Instagram: posts sem container e sangrando até a borda da tela no celular (margem negativa = padding lateral da página). */}
                <div className="grid grid-cols-1 border-t border-border max-md:-mx-[18px]" data-testid="feed-list">
                  {items.map((post) => (
                    <PostCard key={post.id} post={post} allowComments={data.allowComments} />
                  ))}
                </div>
                <div ref={sentinel} className="flex flex-col items-center gap-2 py-2" data-testid="feed-footer">
                  {hasNextPage ? (
                    <Button type="button" variant="outline" className="h-11" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="feed-more">
                      {isFetchingNextPage ? "Carregando…" : "Ver mais"}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Você viu tudo por enquanto.</p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </MediaErrorContext.Provider>
  );
}
