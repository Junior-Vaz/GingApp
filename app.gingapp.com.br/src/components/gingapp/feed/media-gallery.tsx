import { useContext, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { MediaErrorContext, feedMediaSrc, type FeedMedia } from "@/lib/feed";
import { cn } from "@/lib/utils";

/** Foto única nunca fica mais estreita que 4:5 nem mais larga que ~16:9 (corta com object-cover). */
const clampRatio = (media: FeedMedia) => {
  const ratio = media.width > 0 && media.height > 0 ? media.width / media.height : 1;
  return Math.min(1.78, Math.max(0.8, ratio));
};

function Photo({ media, src, className, eager = false }: { media: FeedMedia; src: string; className?: string; eager?: boolean }) {
  const onMediaError = useContext(MediaErrorContext);
  return (
    <img
      src={feedMediaSrc(src)}
      alt=""
      width={media.width}
      height={media.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => onMediaError(media.id)}
      className={className}
    />
  );
}

/** Visualizador em tela cheia: deslize (toque), setas do teclado, botões e fechar. */
function PhotoViewer({ media, index, onIndex, onClose }: { media: FeedMedia[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const touchStart = useRef<number | null>(null);
  const current = media[index];
  const last = media.length - 1;
  const go = (step: number) => onIndex(Math.min(last, Math.max(0, index + step)));
  if (!current) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="photo-viewer"
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") go(-1);
            if (event.key === "ArrowRight") go(1);
          }}
          onTouchStart={(event) => {
            touchStart.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            const end = event.changedTouches[0]?.clientX;
            touchStart.current = null;
            if (start === null || end === undefined) return;
            if (end - start > 50) go(-1);
            else if (start - end > 50) go(1);
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Foto {index + 1} de {media.length}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Deslize para os lados para ver as outras fotos.
          </DialogPrimitive.Description>
          <Photo
            key={current.id}
            media={current}
            src={current.url}
            eager
            className="max-h-[100dvh] max-w-full select-none object-contain"
          />
          <DialogPrimitive.Close
            aria-label="Fechar visualizador"
            className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X size={22} />
          </DialogPrimitive.Close>
          {media.length > 1 && (
            <>
              <p
                className="absolute left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white"
                data-testid="viewer-counter"
                aria-hidden="true"
              >
                {index + 1} / {media.length}
              </p>
              <button
                type="button"
                aria-label="Foto anterior"
                disabled={index === 0}
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                type="button"
                aria-label="Próxima foto"
                disabled={index === last}
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Galeria do post, estilo Instagram: SEM cantos arredondados e em largura total (quem usa a põe sangrando até a borda);
 * 1 foto grande (altura máxima 75vh, o excesso é cortado com object-cover); 2-6 em grade. Toque abre o visualizador.
 * A proporção é reservada (sem salto de layout).
 */
export function MediaGallery({ media }: { media: FeedMedia[] }) {
  const [viewer, setViewer] = useState<number | null>(null);
  // Quando a lista é recarregada (URLs novas) o visualizador aberto acompanha; se a foto sumiu, fecha.
  useEffect(() => {
    if (viewer !== null && viewer >= media.length) setViewer(null);
  }, [media.length, viewer]);

  if (media.length === 0) return null;
  const single = media.length === 1 ? media[0] : undefined;

  return (
    <>
      {single ? (
        <button
          type="button"
          data-testid="media-gallery"
          aria-label="Abrir foto"
          onClick={() => setViewer(0)}
          className="block max-h-[75vh] w-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={{ aspectRatio: String(clampRatio(single)) }}
        >
          <Photo media={single} src={single.url} className="h-full w-full object-cover" />
        </button>
      ) : (
        <div
          data-testid="media-gallery"
          className={cn("grid gap-0.5 overflow-hidden", media.length >= 5 ? "grid-cols-3" : "grid-cols-2")}
        >
          {media.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Abrir foto ${index + 1} de ${media.length}`}
              onClick={() => setViewer(index)}
              className="aspect-square min-w-0 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Photo media={item} src={item.thumbUrl} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {viewer !== null && <PhotoViewer media={media} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </>
  );
}
