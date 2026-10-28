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

const cardBase =
  "flex w-full flex-col items-center rounded-2xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Moldura do cartão: anel de marca (verde -> âmbar) para não visto, cinza para já visto. 104x148 px. */
function CardFrame({ unseen, children }: { unseen: boolean; children: React.ReactNode }) {
  return (
    <span className="block h-[148px] w-full rounded-[18px] p-0.5" style={{ background: unseen ? RING_UNSEEN : "var(--border)" }} data-testid="story-ring" data-unseen={unseen}>
      <span className="block h-full w-full rounded-2xl bg-background p-0.5">
        <span className="relative block h-full w-full overflow-hidden rounded-[14px] bg-muted">{children}</span>
      </span>
    </span>
  );
}

function AvatarOnEdge({ children }: { children: React.ReactNode }) {
  return <span className="relative z-10 -mt-5 block rounded-full ring-[3px] ring-background">{children}</span>;
}

function StoryCard({ group, onOpen, onMediaError }: { group: StoryGroup; onOpen: () => void; onMediaError: (mediaId: number) => void }) {
  const latest = latestOf(group);
  const name = authorLabel(group.author);
  return (
    <li className="w-[104px] flex-none snap-start" data-testid="story-card" data-author-id={group.author?.userId ?? ""} data-unseen={group.hasUnseen}>
      <button
        type="button"
        className={cardBase}
        onClick={onOpen}
        aria-label={`Ver story de ${name}${group.hasUnseen ? " (novo)" : ""}`}
      >
        <CardFrame unseen={group.hasUnseen}>
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
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" aria-hidden="true" />
        </CardFrame>
        <AvatarOnEdge>
          <Avatar decorative name={group.author?.name ?? "?"} src={group.author?.photo ?? null} size={40} />
        </AvatarOnEdge>
        <span className="mt-1 block w-full truncate px-0.5 text-xs font-semibold" data-testid="story-name">
          {shortName(group)}
        </span>
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
      <li className="w-[104px] flex-none snap-start" data-testid="my-story-card" data-state="empty">
        <button type="button" className={cardBase} onClick={onCreate} aria-label="Criar seu story">
          <CardFrame unseen={false}>
            <span className="flex h-full w-full items-center justify-center bg-secondary">
              <Avatar decorative name={me.name} src={me.photo} size={64} />
            </span>
          </CardFrame>
          <span
            className="relative z-10 -mt-5 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background"
            aria-hidden="true"
            data-testid="my-story-plus"
          >
            <Plus size={20} strokeWidth={2.5} />
          </span>
          <span className="mt-1 block w-full truncate px-0.5 text-xs font-semibold">Seu story</span>
        </button>
      </li>
    );
  }

  const latest = latestOf(mine);
  const pending = allPending(mine);
  return (
    <li className="relative w-[104px] flex-none snap-start" data-testid="my-story-card" data-state={pending ? "pending" : "active"}>
      <button
        type="button"
        className={cardBase}
        onClick={onOpen}
        aria-label={pending ? "Ver seu story (aguardando aprovação)" : "Ver seu story"}
      >
        <CardFrame unseen={false}>
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
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" aria-hidden="true" />
          {pending && (
            <span
              className="absolute inset-x-1 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-md bg-black/60 px-1 py-1.5 text-[10px] font-semibold leading-tight text-white"
              data-testid="my-story-pending"
            >
              <Clock size={14} aria-hidden="true" />
              Aguardando aprovação
            </span>
          )}
        </CardFrame>
        <AvatarOnEdge>
          <Avatar decorative name={me.name} src={mine.author?.photo ?? me.photo} size={40} />
        </AvatarOnEdge>
        <span className="mt-1 block w-full truncate px-0.5 text-xs font-semibold">Seu story</span>
      </button>
      {canPost && (
        <button
          type="button"
          aria-label="Criar outro story"
          data-testid="my-story-add"
          onClick={onCreate}
          className="absolute right-0 top-[118px] z-20 flex h-11 w-9 items-center justify-center focus-visible:outline-none"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Plus size={14} strokeWidth={3} aria-hidden="true" />
          </span>
        </button>
      )}
    </li>
  );
}

/**
 * Linha de stories do topo da Home. Só existe com o feed LIGADO (`useFeedSettings().data?.enabled`): carregando, erro ou
 * desligado = nada na tela e nenhuma mensagem. Sem nenhum story e sem permissão de postar = também some. A rolagem
 * horizontal fica DENTRO da linha (a página não estoura) com snap; o primeiro cartão é o "Seu story".
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
      <Reveal className={className}>
        <section className="min-w-0 max-w-full" aria-label="Stories do grupo" data-testid="stories-row">
          {/* No celular a linha vai até a borda da tela (como o banner): o cartão cortado na ponta mostra que dá para rolar. */}
          <ul
            className="flex snap-x snap-mandatory scroll-px-[18px] gap-3 overflow-x-auto px-1 pb-1 pt-1 [scrollbar-width:thin] max-md:-mx-[18px] max-md:px-[18px] max-md:[scrollbar-width:none]"
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
