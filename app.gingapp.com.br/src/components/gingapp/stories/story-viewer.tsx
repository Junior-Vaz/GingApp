import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { authorLabel, feedErrorMessage, feedMediaSrc, feedTime } from "@/lib/feed";
import {
  STORY_DURATION_MS,
  firstUnseenIndex,
  removeStoryFromCache,
  storyGroupKey,
  useDeleteStory,
  useMarkStoryViewed,
  type StoryGroup,
} from "@/lib/stories";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Avatar } from "../avatar";
import { ConfirmDialog } from "../feed/feed-sheet";

/** Toque mais longo que isso conta como "segurar para pausar" e não troca de foto ao soltar. */
const HOLD_MS = 250;

/**
 * Visualizador de stories em tela cheia. Um autor por vez, uma barra de progresso por foto. Avança sozinho a cada 5 s
 * (pausa ao segurar, com a aba oculta, com a confirmação aberta e enquanto a foto carrega); toque na metade direita
 * avança, na esquerda volta; passa para o próximo autor ao terminar e fecha no fim da fila. Setas do teclado e Esc.
 * Com `prefers-reduced-motion` não há avanço automático (a navegação é manual). Marca cada foto como vista ao exibi-la.
 * É um Dialog do Radix: o foco fica preso, a rolagem da página é bloqueada e o foco volta ao cartão ao fechar.
 */
export function StoryViewer({
  groups,
  startKey,
  onClose,
  onMediaError,
}: {
  /** Grupos vivos (do cache), já ordenados. */
  groups: StoryGroup[];
  startKey: string;
  onClose: () => void;
  onMediaError: (mediaId: number) => void;
}) {
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const markViewed = useMarkStoryViewed();
  const remove = useDeleteStory();
  // Ordem dos autores congelada ao abrir: marcar como visto reordena a linha, mas não a fila de quem está assistindo.
  const [keys] = useState(() => groups.map(storyGroupKey));
  const [groupKey, setGroupKey] = useState(startKey);
  const [index, setIndex] = useState(() => {
    const first = groups.find((group) => storyGroupKey(group) === startKey);
    return first ? firstUnseenIndex(first) : 0;
  });
  const [restarts, setRestarts] = useState(0);
  const [holding, setHolding] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const [confirming, setConfirming] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const holdStarted = useRef(0);
  const heldLong = useRef(false);
  const viewed = useRef(new Set<number>());

  const group = groups.find((candidate) => storyGroupKey(candidate) === groupKey);
  const safeIndex = group ? Math.min(index, group.items.length - 1) : 0;
  const item = group?.items[safeIndex];
  const itemKey = item ? `${item.id}:${restarts}` : null;
  const src = item ? feedMediaSrc(item.media.url) : null;
  const loaded = src !== null && loadedSrc === src;
  const paused = holding || hidden || confirming || !loaded;

  const groupAt = useCallback(
    (position: number) => {
      const key = keys[position];
      return key === undefined ? undefined : groups.find((candidate) => storyGroupKey(candidate) === key);
    },
    [keys, groups],
  );

  /** Vai para o autor `step` posições adiante/atrás (pulando quem sumiu). `false` = não há mais ninguém nessa direção. */
  const moveGroup = useCallback(
    (step: 1 | -1) => {
      let position = keys.indexOf(groupKey) + step;
      while (position >= 0 && position < keys.length) {
        const target = groupAt(position);
        if (target) {
          setGroupKey(keys[position]!);
          setIndex(step === 1 ? firstUnseenIndex(target) : target.items.length - 1);
          return true;
        }
        position += step;
      }
      return false;
    },
    [keys, groupKey, groupAt],
  );

  const next = useCallback(() => {
    if (!group) return;
    if (safeIndex < group.items.length - 1) setIndex(safeIndex + 1);
    else if (!moveGroup(1)) onClose();
  }, [group, safeIndex, moveGroup, onClose]);

  const previous = useCallback(() => {
    if (safeIndex > 0) setIndex(safeIndex - 1);
    else if (!moveGroup(-1)) setRestarts((count) => count + 1); // já é o primeiro de todos: recomeça este
  }, [safeIndex, moveGroup]);

  // O autor sumiu (apagou o último story): segue para o próximo ou fecha.
  useEffect(() => {
    if (!group && !moveGroup(1)) onClose();
  }, [group, moveGroup, onClose]);

  // Aba oculta pausa.
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Marca como visto ao exibir (uma vez por foto; o próprio autor não precisa).
  useEffect(() => {
    if (!item || !group || group.isMine || item.seen || viewed.current.has(item.id)) return;
    viewed.current.add(item.id);
    markViewed.mutate(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Auto-avanço. `remaining` guarda o que falta para a foto atual: pausar/retomar não zera o tempo.
  const remaining = useRef(STORY_DURATION_MS);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current !== itemKey) {
      lastKey.current = itemKey;
      remaining.current = STORY_DURATION_MS;
    }
    if (reduced || paused || itemKey === null) return;
    const startedAt = Date.now();
    const timer = setTimeout(next, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [itemKey, paused, reduced, next]);

  function startHold() {
    holdStarted.current = Date.now();
    heldLong.current = false;
    setHolding(true);
  }
  function endHold() {
    if (holdStarted.current && Date.now() - holdStarted.current >= HOLD_MS) heldLong.current = true;
    holdStarted.current = 0;
    setHolding(false);
  }
  function tap(step: 1 | -1) {
    if (heldLong.current) {
      heldLong.current = false;
      return;
    }
    if (step === 1) next();
    else previous();
  }

  function confirmDelete() {
    if (!item) return;
    const storyId = item.id;
    remove.mutate(storyId, {
      onSuccess: () => {
        setConfirming(false);
        removeStoryFromCache(queryClient, storyId);
        toast.success("Story apagado.");
      },
      onError: (error) => {
        setConfirming(false);
        toast.error(feedErrorMessage(error, "Não foi possível apagar o story."));
      },
    });
  }

  if (!group || !item) return null;
  const name = authorLabel(group.author);
  const pending = item.status === "PENDING_APPROVAL";

  return (
    <>
      <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            ref={content}
            data-testid="story-viewer"
            aria-label={`Story de ${name}`}
            tabIndex={-1}
            className="fixed inset-0 z-50 flex justify-center outline-none"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              content.current?.focus();
            }}
            // Sem <Trigger> o Radix não sabe para onde devolver o foco: volta ao cartão que abriu o visualizador.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") next();
              if (event.key === "ArrowLeft") previous();
            }}
          >
            <DialogPrimitive.Title className="sr-only">Story de {name}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Foto {safeIndex + 1} de {group.items.length}. Toque do lado direito para avançar e do lado esquerdo para voltar.
              {reduced ? " O avanço automático está desligado." : ""}
            </DialogPrimitive.Description>

            <div className="relative h-full w-full max-w-md select-none overflow-hidden">
              {/* Foto + áreas de toque (metade esquerda volta, metade direita avança; segurar pausa). */}
              <div
                className="absolute inset-0 flex items-center justify-center"
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={() => holdStarted.current && endHold()}
                onPointerCancel={endHold}
                onContextMenu={(event) => event.preventDefault()}
              >
                <img
                  key={src}
                  src={src!}
                  alt={item.caption ?? `Foto de ${name}`}
                  width={item.media.width}
                  height={item.media.height}
                  decoding="async"
                  draggable={false}
                  data-testid="story-image"
                  onLoad={() => setLoadedSrc(src)}
                  onError={() => {
                    onMediaError(item.media.id);
                    setLoadedSrc(src); // não trava a fila; a recarga traz URLs novas
                  }}
                  className="max-h-full max-w-full object-contain"
                />
                <button
                  type="button"
                  aria-label="Foto anterior"
                  data-testid="story-prev"
                  className="absolute inset-y-0 left-0 w-1/2 focus-visible:outline-none"
                  onClick={() => tap(-1)}
                />
                <button
                  type="button"
                  aria-label="Próxima foto"
                  data-testid="story-next"
                  className="absolute inset-y-0 right-0 w-1/2 focus-visible:outline-none"
                  onClick={() => tap(1)}
                />
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent px-3 pb-8 pt-[max(0.5rem,env(safe-area-inset-top))]">
                <div className="flex gap-1" role="img" aria-label={`Foto ${safeIndex + 1} de ${group.items.length}`} data-testid="story-bars">
                  {group.items.map((entry, position) => {
                    const state = position < safeIndex ? "done" : position === safeIndex ? "active" : "todo";
                    return (
                      <span key={entry.id} className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/35" data-testid="story-bar" data-state={state}>
                        {state === "done" || (state === "active" && reduced) ? (
                          <span className="block h-full w-full bg-white" />
                        ) : state === "active" ? (
                          <span
                            key={itemKey}
                            className="block h-full w-full origin-left bg-white"
                            style={{
                              animation: `story-progress ${STORY_DURATION_MS}ms linear forwards`,
                              animationPlayState: paused ? "paused" : "running",
                            }}
                          />
                        ) : null}
                      </span>
                    );
                  })}
                </div>
                <div className="pointer-events-auto mt-2 flex items-center gap-2 text-white">
                  <Avatar decorative name={group.author?.name ?? "?"} src={group.author?.photo ?? null} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" data-testid="story-author">
                      {group.isMine ? "Seu story" : name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-white/80">
                      <time dateTime={item.createdAt} data-testid="story-time">
                        {feedTime(item.createdAt)}
                      </time>
                      {pending && (
                        <span className="inline-flex items-center gap-1 rounded bg-white/20 px-1.5 py-0.5" data-testid="story-pending">
                          <Clock size={11} aria-hidden="true" /> Aguardando aprovação
                        </span>
                      )}
                    </p>
                  </div>
                  {group.isMine && (
                    <button
                      type="button"
                      data-testid="story-delete"
                      className="flex h-11 items-center gap-1.5 rounded-full bg-black/50 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      onClick={() => setConfirming(true)}
                    >
                      <Trash2 size={16} aria-hidden="true" /> Apagar
                    </button>
                  )}
                  <DialogPrimitive.Close
                    aria-label="Fechar story"
                    data-testid="story-close"
                    className="flex size-11 items-center justify-center rounded-full bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <X size={22} />
                  </DialogPrimitive.Close>
                </div>
              </div>

              {item.caption && (
                <p
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 whitespace-pre-wrap break-words bg-gradient-to-t from-black/75 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12 text-sm leading-snug text-white [overflow-wrap:anywhere]"
                  data-testid="story-caption"
                >
                  {item.caption}
                </p>
              )}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apagar story?"
        description="O story e a foto saem do grupo. Essa ação não pode ser desfeita."
        confirmLabel="Apagar"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
