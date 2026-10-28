import { useMemo, useState } from "react";
import { Clock, Plus } from "lucide-react";
import { authorLabel, feedMediaSrc, feedKeys, useFeedSettings, useMediaErrorRefetch } from "@/lib/feed";
import { allPending, orderStoryGroups, storyGroupKey, useStories, type StoryGroup } from "@/lib/stories";
import { useMyIdentity } from "@/lib/queries";
import { Avatar } from "../avatar";
import { Reveal } from "../reveal";
import { StoryComposer } from "./story-composer";
import { StoryViewer } from "./story-viewer";

const MEDIA_KEYS = [feedKeys.stories] as const;

/** Nome curto embaixo do cartão: apelido, senão o primeiro nome. */
function shortName(group: StoryGroup): string {
  const author = group.author;
  if (!author) return "Ex-integrante";
  return author.nickname?.trim() || author.name.split(" ")[0] || author.name;
}

/** Miniatura mais recente do grupo (a que o cartão mostra). */
const latestOf = (group: StoryGroup) => group.items[group.items.length - 1]!;

const RING_UNSEEN = "linear-gradient(135deg, var(--primary), var(--warning))";
const RING_SEEN = "oklch(0.72 0.01 150)";

/** Avatar do cartão em px (anel de 2 px + 1 px de respiro ao redor = ~32 px no total). */
const AVATAR_SIZE = 26;

/**
 * Cada cartão (`li.story-tile`) tem cantos RETOS e 20% da faixa (`w-1/5`); a proporção largura/altura vem da constante CSS
 * única `--story-aspect` (styles.css; .78 = um pouco mais alto que largo, 1 = quadrado). O botão preenche o cartão
 * inteiro; nada de margem, gap, borda ou divisória entre cartões.
 */
const tileButton =
  "absolute inset-0 block h-full w-full overflow-hidden bg-muted p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Gradiente escuro só na base do cartão (legibilidade do nome). */
function BaseShade() {
  return <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 to-transparent" aria-hidden="true" />;
}

/** Nome na base do cartão: branco, 11 px, truncado. */
function TileName({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span
      className="absolute inset-x-0 bottom-0 block truncate px-1.5 pb-1.5 text-[11px] font-semibold leading-tight text-white"
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/** Avatar pequeno no canto SUPERIOR ESQUERDO, com anel verde->âmbar (não visto) ou cinza (visto). */
function CornerAvatar({ unseen, children }: { unseen: boolean; children: React.ReactNode }) {
  return (
    <span
      className="absolute left-1.5 top-1.5 z-10 block rounded-full p-0.5"
      style={{ background: unseen ? RING_UNSEEN : RING_SEEN }}
      data-testid="story-ring"
      data-unseen={unseen}
      data-ring={unseen ? "brand" : "gray"}
    >
      <span className="block rounded-full bg-background p-px">{children}</span>
    </span>
  );
}

function StoryCard({ group, onOpen, onMediaError }: { group: StoryGroup; onOpen: () => void; onMediaError: (mediaId: number) => void }) {
  const latest = latestOf(group);
  const name = authorLabel(group.author);
  return (
    <li className="story-tile relative w-1/5 flex-none snap-start" data-testid="story-card" data-author-id={group.author?.userId ?? ""} data-unseen={group.hasUnseen}>
      <button type="button" className={tileButton} onClick={onOpen} aria-label={`Ver story de ${name}${group.hasUnseen ? " (novo)" : ""}`}>
        <img
          src={feedMediaSrc(latest.media.thumbUrl)}
          alt=""
          width={latest.media.width}
          height={latest.media.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => onMediaError(latest.media.id)}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <BaseShade />
        <CornerAvatar unseen={group.hasUnseen}>
          <Avatar decorative name={group.author?.name ?? "?"} src={group.author?.photo ?? null} size={AVATAR_SIZE} />
        </CornerAvatar>
        <TileName testId="story-name">{shortName(group)}</TileName>
      </button>
    </li>
  );
}

/** Primeiro cartão. Sem story meu: "+" para criar. Com story: minha miniatura (e um "+" separado para criar outro). */
function MyStoryCard({
  mine,
  canPost,
  me,
  onOpen,
  onCreate,
  onMediaError,
}: {
  mine: StoryGroup | undefined;
  canPost: boolean;
  me: { name: string; photo: string | null };
  onOpen: () => void;
  onCreate: () => void;
  onMediaError: (mediaId: number) => void;
}) {
  if (!mine) {
    return (
      <li className="story-tile relative w-1/5 flex-none snap-start" data-testid="my-story-card" data-state="empty">
        <button type="button" className={`${tileButton} bg-primary`} onClick={onCreate} aria-label="Criar seu story">
          <CornerAvatar unseen={false}>
            <Avatar decorative name={me.name} src={me.photo} size={AVATAR_SIZE} />
          </CornerAvatar>
          <span
            className="absolute left-1/2 top-[44%] flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary-foreground text-primary"
            aria-hidden="true"
            data-testid="my-story-plus"
          >
            <Plus size={20} strokeWidth={2.5} />
          </span>
          <TileName>Seu story</TileName>
        </button>
      </li>
    );
  }

  const latest = latestOf(mine);
  const pending = allPending(mine);
  return (
    <li className="story-tile relative w-1/5 flex-none snap-start" data-testid="my-story-card" data-state={pending ? "pending" : "active"}>
      <button
        type="button"
        className={tileButton}
        onClick={onOpen}
        aria-label={pending ? "Ver seu story (aguardando aprovação)" : "Ver seu story"}
      >
        <img
          src={feedMediaSrc(latest.media.thumbUrl)}
          alt=""
          width={latest.media.width}
          height={latest.media.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => onMediaError(latest.media.id)}
          className={`absolute inset-0 h-full w-full object-cover ${pending ? "opacity-60" : ""}`}
        />
        <BaseShade />
        {pending && (
          <span
            className="absolute inset-x-1 top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5 rounded-md bg-black/60 px-1 py-1 text-[10px] font-semibold leading-tight text-white"
            data-testid="my-story-pending"
          >
            <Clock size={12} aria-hidden="true" />
            Aguardando aprovação
          </span>
        )}
        <CornerAvatar unseen={false}>
          <Avatar decorative name={me.name} src={mine.author?.photo ?? me.photo} size={AVATAR_SIZE} />
        </CornerAvatar>
        <TileName>Seu story</TileName>
      </button>
      {canPost && (
        <button
          type="button"
          aria-label="Criar outro story"
          data-testid="my-story-add"
          onClick={onCreate}
          className="absolute right-0 top-0 z-20 flex size-11 items-start justify-end pr-1 pt-1.5 focus-visible:outline-none"
        >
          {/* O círculo visível é de 20 px, encostado no canto superior direito (não encosta no avatar nem a 320 px); a área de toque é 44x44. */}
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-white">
            <Plus size={12} strokeWidth={3} aria-hidden="true" />
          </span>
        </button>
      )}
    </li>
  );
}

/**
 * Faixa de stories do topo da Home, COLADA no banner (mesma largura, sem espaço entre os dois; o arredondamento externo
 * é do conjunto: cantos de cima da faixa, e o banner perde os de cima via `.stories-attached + .welcome-banner`).
 * 5 cartões quadrados de 20% da largura, um colado no outro (gap 0, sem divisória); com mais de 5 a faixa rola na
 * horizontal com scroll-snap; com menos de 5 os cartões NÃO esticam (o resto fica no fundo neutro da faixa). O primeiro
 * cartão é o "Seu story". Só existe com o feed LIGADO (`useFeedSettings().data?.enabled`): carregando, erro ou desligado
 * = nada na tela e nenhuma mensagem. Sem nenhum story e sem permissão de postar = também some.
 */
export function StoriesRow({ className = "" }: { className?: string }) {
  const settings = useFeedSettings();
  const feedOn = settings.data?.enabled === true;
  const canPost = feedOn && settings.data?.canPost === true;
  const stories = useStories(feedOn);
  const me = useMyIdentity();
  const onMediaError = useMediaErrorRefetch(MEDIA_KEYS);
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const groups = useMemo(() => orderStoryGroups(stories.data?.groups ?? []), [stories.data]);
  const mine = groups.find((group) => group.isMine);
  const others = groups.filter((group) => !group.isMine);

  if (!feedOn || !stories.data || !settings.data) return null;
  if (groups.length === 0 && !canPost) return null;

  return (
    <>
      <Reveal className={`stories-attached ${className}`.trim()}>
        <section className="min-w-0 max-w-full" aria-label="Stories do grupo" data-testid="stories-row">
          {/* Sem gap, sem padding e sem borda entre cartões; no celular a faixa vai até a borda da tela (como o banner). */}
          <ul
            className="stories-strip m-0 flex list-none snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain bg-secondary p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:-mx-[18px] md:rounded-t-lg"
            data-testid="stories-list"
          >
            {(canPost || mine) && (
              <MyStoryCard
                mine={mine}
                canPost={canPost}
                me={me}
                onOpen={() => mine && setViewerKey(storyGroupKey(mine))}
                onCreate={() => canPost && setComposing(true)}
                onMediaError={onMediaError}
              />
            )}
            {others.map((group) => (
              <StoryCard key={storyGroupKey(group)} group={group} onOpen={() => setViewerKey(storyGroupKey(group))} onMediaError={onMediaError} />
            ))}
          </ul>
        </section>
      </Reveal>
      {canPost && <StoryComposer open={composing} onOpenChange={setComposing} settings={settings.data} />}
      {viewerKey !== null && (
        <StoryViewer groups={groups} startKey={viewerKey} onClose={() => setViewerKey(null)} onMediaError={onMediaError} />
      )}
    </>
  );
}
