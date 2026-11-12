import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ImageOff, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  cropRect,
  distance,
  imageBox,
  initialView,
  midpoint,
  normalizeView,
  panBy,
  toNormalized,
  zoomAt,
  type Point,
  type Size,
  type ViewState,
} from "@/lib/photo/crop-math";
import {
  HEIC_UNSUPPORTED_MESSAGE,
  PHOTO_ERROR_MESSAGES,
  photoErrorMessage,
} from "@/lib/photo/messages";
import { prepareImage } from "@/lib/photo/prepare-image";
import type { PrepareImageOptions } from "@/lib/photo/types";
import { useObjectUrl } from "@/lib/photo/use-object-url";

export interface CropDialogProps {
  open: boolean;
  /** Foto escolhida ou tirada (a ORIGINAL nunca é enviada: sai `prepareImage` do recorte). */
  source: Blob | null;
  /** Teto do arquivo de saída (padrão do `prepareImage`: 400 KB). */
  maxBytes?: number;
  /** "Usar esta foto": Blob WebP/JPEG recortado (quadrado) e comprimido, pronto para envio. */
  onConfirm: (photo: Blob) => void;
  /** "Cancelar", X, Esc ou clique fora. */
  onCancel: () => void;
  /** "Escolher outra". */
  onChooseAnother: () => void;
  /** Chamado quando o diálogo termina de fechar: quem abriu devolve o foco ao botão de origem (`event.preventDefault()`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Lado da janela de recorte quando ainda não deu para medir (diálogo animando, jsdom). */
const DEFAULT_VIEWPORT = 280;
const KEY_STEP = 16;
const KEY_STEP_FAST = 48;
const ZOOM_KEY_STEP = 0.25;

/** Controle de zoom com alça grande (24 px) e área de toque de 44 px de altura (o padrão do navegador tem alça de 16 px). */
const ZOOM_RANGE_CLASS =
  "h-11 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 " +
  "[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted-foreground/25 " +
  "[&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow " +
  "[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted-foreground/25 " +
  "[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary " +
  "focus-visible:outline-none focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-ring focus-visible:[&::-moz-range-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-ring";

/**
 * Recorte quadrado da foto com moldura redonda: arrastar com o ponteiro (mouse/toque), pinça de dois dedos, roda do mouse,
 * controle de zoom e teclado (setas movem; + e − ampliam; 0 volta ao início). O recorte nunca deixa área vazia.
 */
export function CropDialog({
  open,
  source,
  maxBytes,
  onConfirm,
  onCancel,
  onChooseAnother,
  onCloseAutoFocus,
}: CropDialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  return (
    <Dialog
      open={open && source !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        ref={contentRef}
        className="sm:max-w-md"
        data-testid="crop-dialog"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
        onOpenAutoFocus={(event) => {
          // O foco vai para a área de recorte: o teclado já pode mover/ampliar.
          const target = contentRef.current?.querySelector<HTMLElement>("[data-autofocus]");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        {source && (
          <CropBody
            source={source}
            {...(maxBytes === undefined ? {} : { maxBytes })}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onChooseAnother={onChooseAnother}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Ponto do ponteiro relativo ao CENTRO da janela (âncora do zoom). */
function anchorInside(el: HTMLElement | null, clientX: number, clientY: number): Point {
  const rect = el?.getBoundingClientRect();
  if (!rect || rect.width === 0) return { x: 0, y: 0 };
  return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
}

function CropBody({
  source,
  maxBytes,
  onConfirm,
  onCancel,
  onChooseAnother,
}: {
  source: Blob;
  maxBytes?: number;
  onConfirm: (photo: Blob) => void;
  onCancel: () => void;
  onChooseAnother: () => void;
}) {
  const url = useObjectUrl(source);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const lastPinch = useRef<number | null>(null);
  const viewportSize = useRef(DEFAULT_VIEWPORT);
  const alive = useRef(true);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [natural, setNatural] = useState<Size | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [view, setView] = useState<ViewState>(initialView);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Mede a janela (quadrada) e acompanha mudanças (girar o celular, redimensionar). O pan é em px de tela: acompanha a escala.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const side = el.clientWidth;
      if (!(side > 0) || side === viewportSize.current) return;
      const ratio = side / viewportSize.current;
      viewportSize.current = side;
      setViewport(side);
      setView((current) => ({
        ...current,
        panX: current.panX * ratio,
        panY: current.panY * ratio,
      }));
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const current = natural ? normalizeView(view, natural, viewport) : view;
  const box = natural ? imageBox(view, natural, viewport) : null;

  const anchorOf = (clientX: number, clientY: number): Point =>
    anchorInside(viewportRef.current, clientX, clientY);

  // Roda do mouse: listener nativo NÃO passivo (o do React é passivo e não deixaria impedir a rolagem da página).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !natural) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      const anchor = anchorInside(el, event.clientX, event.clientY);
      setView((v) => zoomAt(v, v.zoom * factor, anchor, natural, viewport));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [natural, viewport]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!natural || processing) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* sem captura: o arraste continua enquanto o ponteiro estiver sobre a janela */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      lastPinch.current = a && b ? distance(a, b) : null;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || !natural) return;
    const next = { x: event.clientX, y: event.clientY };
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, next);
    if (pointers.current.size === 1) {
      setView((v) => panBy(v, next.x - previous.x, next.y - previous.y, natural, viewport));
      return;
    }
    // Pinça: amplia em torno do ponto médio dos dois dedos e acompanha o movimento dele.
    const after = [...pointers.current.values()];
    const [a, b] = after;
    const [pa, pb] = before;
    if (!a || !b || !pa || !pb) return;
    const gap = distance(a, b);
    const ratio = lastPinch.current && lastPinch.current > 0 ? gap / lastPinch.current : 1;
    lastPinch.current = gap;
    const mid = midpoint(a, b);
    const prevMid = midpoint(pa, pb);
    const anchor = anchorOf(mid.x, mid.y);
    setView((v) =>
      panBy(
        zoomAt(v, v.zoom * ratio, anchor, natural, viewport),
        mid.x - prevMid.x,
        mid.y - prevMid.y,
        natural,
        viewport,
      ),
    );
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) lastPinch.current = null;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!natural || processing) return;
    const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    const centre = { x: 0, y: 0 };
    switch (event.key) {
      case "ArrowLeft":
        setView((v) => panBy(v, -step, 0, natural, viewport));
        break;
      case "ArrowRight":
        setView((v) => panBy(v, step, 0, natural, viewport));
        break;
      case "ArrowUp":
        setView((v) => panBy(v, 0, -step, natural, viewport));
        break;
      case "ArrowDown":
        setView((v) => panBy(v, 0, step, natural, viewport));
        break;
      case "+":
      case "=":
        setView((v) => zoomAt(v, v.zoom + ZOOM_KEY_STEP, centre, natural, viewport));
        break;
      case "-":
      case "_":
        setView((v) => zoomAt(v, v.zoom - ZOOM_KEY_STEP, centre, natural, viewport));
        break;
      case "0":
        setView(initialView());
        break;
      default:
        return; // Esc, Tab etc. seguem para o diálogo
    }
    event.preventDefault();
  }

  function stepZoom(delta: number) {
    if (!natural) return;
    setView((v) => zoomAt(v, v.zoom + delta, { x: 0, y: 0 }, natural, viewport));
  }

  async function confirm() {
    if (!natural || processing) return;
    setProcessing(true);
    setError(null);
    try {
      const opts: PrepareImageOptions = {
        shape: "square",
        crop: toNormalized(cropRect(view, natural, viewport), natural),
      };
      if (maxBytes !== undefined) opts.maxBytes = maxBytes;
      const photo = await prepareImage(source, opts);
      if (alive.current) onConfirm(photo);
    } catch (failure) {
      if (alive.current) setError(photoErrorMessage(failure));
    } finally {
      if (alive.current) setProcessing(false);
    }
  }

  const heic = /^image\/hei[cf]/i.test(source.type);
  const loadMessage = heic ? HEIC_UNSUPPORTED_MESSAGE : PHOTO_ERROR_MESSAGES.DECODE_FAILED;
  const zoomPercent = Math.round(current.zoom * 100);
  const canUse = natural !== null && !loadFailed && !processing;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ajustar foto</DialogTitle>
        <DialogDescription className="text-xs sm:text-sm">
          Arraste a imagem e use o zoom para enquadrar o rosto no círculo.
        </DialogDescription>
      </DialogHeader>

      <div className="mx-auto w-[min(100%,41dvh)]">
        <div
          ref={viewportRef}
          role="group"
          tabIndex={0}
          data-autofocus=""
          data-testid="crop-viewport"
          aria-label="Área de recorte. Setas movem a imagem, mais e menos ampliam, zero volta ao início."
          className="relative aspect-square w-full cursor-grab touch-none select-none overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          {url && !loadFailed && (
            <img
              src={url}
              alt=""
              draggable={false}
              data-testid="crop-image"
              className={
                box
                  ? "pointer-events-none absolute max-w-none select-none"
                  : "pointer-events-none invisible absolute max-w-none"
              }
              style={
                box
                  ? { left: box.left, top: box.top, width: box.width, height: box.height }
                  : undefined
              }
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0)
                  setNatural({ width: naturalWidth, height: naturalHeight });
                else setLoadFailed(true);
              }}
              onError={() => setLoadFailed(true)}
            />
          )}
          {/* Moldura redonda: o escuro fora do círculo é o que sobra nos cantos do quadrado. */}
          {!loadFailed && (
            <div
              className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.5)]"
              aria-hidden
            />
          )}
          {!natural && !loadFailed && (
            <div className="absolute inset-0 grid place-items-center text-white" role="status">
              <Loader2 className="size-6 motion-safe:animate-spin" aria-label="Carregando a foto" />
            </div>
          )}
          {loadFailed && (
            <div className="absolute inset-0 grid place-items-center bg-muted">
              <ImageOff className="size-10 text-muted-foreground" aria-hidden />
            </div>
          )}
        </div>
      </div>

      {!loadFailed && (
        <div className="flex items-center gap-2" data-testid="crop-zoom-controls">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 md:size-11"
            aria-label="Diminuir o zoom"
            disabled={!canUse || current.zoom <= ZOOM_MIN}
            onClick={() => stepZoom(-ZOOM_KEY_STEP)}
          >
            <Minus />
          </Button>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={current.zoom}
            aria-label="Zoom"
            aria-valuetext={`${zoomPercent}%`}
            data-testid="crop-zoom"
            disabled={!canUse}
            className={ZOOM_RANGE_CLASS}
            onChange={(event) => {
              if (!natural) return;
              const next = Number(event.target.value);
              setView((v) => zoomAt(v, next, { x: 0, y: 0 }, natural, viewport));
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 md:size-11"
            aria-label="Aumentar o zoom"
            disabled={!canUse || current.zoom >= ZOOM_MAX}
            onClick={() => stepZoom(ZOOM_KEY_STEP)}
          >
            <Plus />
          </Button>
        </div>
      )}

      {(loadFailed || error) && (
        <p
          className="text-sm text-destructive"
          role="alert"
          aria-live="assertive"
          data-testid="crop-error"
        >
          {loadFailed ? loadMessage : error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          className="h-11 md:h-11"
          disabled={processing}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 md:h-11"
          disabled={processing}
          onClick={onChooseAnother}
        >
          Escolher outra
        </Button>
        <Button
          type="button"
          className="order-first col-span-2 h-11 sm:order-none sm:col-span-1 md:h-11"
          disabled={!canUse}
          onClick={() => void confirm()}
        >
          {processing && <Loader2 className="motion-safe:animate-spin" />}
          {processing ? "Preparando…" : "Usar esta foto"}
        </Button>
      </div>
    </>
  );
}
