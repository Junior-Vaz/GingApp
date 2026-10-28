import { Link } from "@tanstack/react-router";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { MediaErrorContext, feedKeys, useFeedPreview, useFeedSettings, useMediaErrorRefetch } from "@/lib/feed";
import { Reveal } from "../reveal";
import { PostCard } from "./post-card";

const MEDIA_KEYS = [feedKeys.preview] as const;

/**
 * Prévia do Grupo na Home (entre o banner e "Minha graduação"): título, "Ver tudo →" e até 3 posts recentes com o
 * `PostCard` estilo Instagram na variante compacta (sem container, sangrando até a borda da tela; reações e comentários
 * funcionam como no feed). Vazio com `canPost`: convite
 * "Seja o primeiro a postar!" que leva ao feed. Só aparece com o feed LIGADO e já carregado: carregando, erro, desligado
 * ou vazio sem permissão de postar = a seção inteira some, sem mensagem de erro. Substitui o atalho "Grupo" antigo.
 */
export function HomeFeedPreview({ className = "" }: { className?: string }) {
  const settings = useFeedSettings();
  const enabled = settings.data?.enabled === true;
  const preview = useFeedPreview(enabled);
  const onMediaError = useMediaErrorRefetch(MEDIA_KEYS);

  if (!enabled || !settings.data || !preview.data) return null;
  const { canPost, allowComments } = settings.data;
  const items = preview.items;
  if (items.length === 0 && !canPost) return null;

  return (
    <MediaErrorContext.Provider value={onMediaError}>
      <Reveal className={className}>
        <section className="min-w-0 max-w-full pb-px" aria-labelledby="home-feed-title" data-testid="home-feed-preview">
          <div className="mb-1 flex items-center justify-between gap-3 px-px">
            <h2 id="home-feed-title" className="text-base font-bold">
              Grupo
            </h2>
            <Link
              to="/feed"
              className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary no-underline"
              data-testid="home-feed-see-all"
              aria-label="Ver tudo no Grupo"
            >
              Ver tudo <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {items.length > 0 ? (
            // Estilo Instagram: os posts sangram até a borda da tela (margem negativa = padding lateral da página, 18 px no
            // celular); a seção inteira (título, "Ver tudo") segue com o padding normal.
            <div className="grid grid-cols-1 border-t border-border max-md:-mx-[18px]" data-testid="home-feed-list">
              {items.map((post) => (
                <PostCard key={post.id} post={post} allowComments={allowComments} compact />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-5 text-center" data-testid="home-feed-empty">
              <span className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-secondary text-primary" aria-hidden="true">
                <MessagesSquare size={20} />
              </span>
              <p className="font-display text-base font-bold">Seja o primeiro a postar!</p>
              <p className="mt-1 text-sm text-muted-foreground">Conte como foi o treino, mostre uma foto da roda.</p>
              <Link
                to="/feed"
                className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline"
                data-testid="home-feed-post-cta"
              >
                Postar no Grupo
              </Link>
            </div>
          )}
        </section>
      </Reveal>
    </MediaErrorContext.Provider>
  );
}
