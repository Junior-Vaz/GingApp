import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { mediaSrc } from "./api";
import type { FeedMedia } from "./types";

/** Miniatura que cai para um aviso se a URL assinada expirou ou a imagem não carregar. */
function Thumb({ media, index, total, onOpen }: { media: FeedMedia; index: number; total: number; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const src = mediaSrc(media.thumbUrl || media.url);
  const label = `Ampliar foto ${String(index + 1)} de ${String(total)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="relative aspect-square min-w-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {src && !failed ? (
        <img
          src={src}
          alt={`Foto ${String(index + 1)} de ${String(total)}`}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[11px] text-muted-foreground">
          <ImageOff className="size-5" aria-hidden /> Foto indisponível
        </span>
      )}
    </button>
  );
}

/** Foto grande do visualizador, com aviso se não carregar. `key` troca a cada foto (zera o estado de erro). */
function BigPhoto({ media, index, total }: { media: FeedMedia; index: number; total: number }) {
  const [failed, setFailed] = useState(false);
  const src = mediaSrc(media.url);
  return src && !failed ? (
    <img
      src={src}
      alt={`Foto ${String(index + 1)} de ${String(total)} da publicação`}
      className="max-h-[70dvh] w-full rounded-md border bg-muted object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    <p className="flex h-48 items-center justify-center gap-2 rounded-md border bg-muted text-sm text-muted-foreground">
      <ImageOff className="size-4" aria-hidden /> Foto indisponível. Atualize a lista para gerar um novo link.
    </p>
  );
}

/** Galeria da publicação: miniaturas em grade e visualizador ampliado com anterior/próxima. */
export function PostGallery({ media, authorName }: { media: FeedMedia[]; authorName: string }) {
  const [current, setCurrent] = useState<number | null>(null);
  if (media.length === 0) return null;
  const photo = current === null ? undefined : media[current];

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" data-testid="post-gallery">
        {media.map((m, index) => (
          <Thumb key={String(m.id)} media={m} index={index} total={media.length} onOpen={() => setCurrent(index)} />
        ))}
      </div>

      <Dialog open={current !== null} onOpenChange={(open) => !open && setCurrent(null)}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl" data-testid="photo-viewer">
          <DialogTitle>
            Foto {current === null ? 0 : current + 1} de {media.length}
          </DialogTitle>
          <DialogDescription className="sr-only">Publicação de {authorName}</DialogDescription>
          {photo && current !== null && (
            <BigPhoto key={String(photo.id)} media={photo} index={current} total={media.length} />
          )}
          {media.length > 1 && current !== null && (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={current === 0}
                onClick={() => setCurrent(current - 1)}
              >
                <ChevronLeft /> Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={current === media.length - 1}
                onClick={() => setCurrent(current + 1)}
              >
                Próxima <ChevronRight />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
