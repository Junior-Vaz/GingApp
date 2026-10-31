import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import QRCode from "qrcode";
import { ImageIcon } from "lucide-react";
import { imageSrc } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { useLayoutFonts } from "./fonts";
import {
  BOX_HANDLES,
  QR_HANDLES,
  applyVariables,
  elementBox,
  moveElement,
  replaceElement,
  resizeElement,
  snapMove,
  snapResize,
  type Box,
  type Guide,
  type Handle,
  type VariableData,
} from "./layout-utils";
import {
  ELEMENT_TYPE_LABEL,
  PAGE_PT,
  fontDef,
  type CertificateElement,
  type CertificateLayout,
  type ImageEl,
  type QrEl,
  type RectEl,
  type TextEl,
} from "./types";

const HANDLE_STYLE: Record<Handle, { style: CSSProperties; cursor: string }> = {
  nw: { style: { left: 0, top: 0 }, cursor: "cursor-nwse-resize" },
  n: { style: { left: "50%", top: 0 }, cursor: "cursor-ns-resize" },
  ne: { style: { left: "100%", top: 0 }, cursor: "cursor-nesw-resize" },
  e: { style: { left: "100%", top: "50%" }, cursor: "cursor-ew-resize" },
  se: { style: { left: "100%", top: "100%" }, cursor: "cursor-nwse-resize" },
  s: { style: { left: "50%", top: "100%" }, cursor: "cursor-ns-resize" },
  sw: { style: { left: 0, top: "100%" }, cursor: "cursor-nesw-resize" },
  w: { style: { left: 0, top: "50%" }, cursor: "cursor-ew-resize" },
};

const HANDLE_NAME: Record<Handle, string> = {
  nw: "canto superior esquerdo",
  n: "borda superior",
  ne: "canto superior direito",
  e: "borda direita",
  se: "canto inferior direito",
  s: "borda inferior",
  sw: "canto inferior esquerdo",
  w: "borda esquerda",
};

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)}, ${String(alpha)})`;
}

/** QR de EXEMPLO desenhado em SVG (sem canvas): a prévia nunca usa um código real. */
function SampleQr({ fg, text }: { fg: string; text: string }) {
  const path = useMemo(() => {
    try {
      const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
      let d = "";
      for (let row = 0; row < size; row++)
        for (let col = 0; col < size; col++) if (data[row * size + col]) d += `M${String(col)} ${String(row)}h1v1h-1z`;
      return { d, size };
    } catch {
      return null;
    }
  }, [text]);
  if (!path) return null;
  return (
    <svg viewBox={`0 0 ${String(path.size)} ${String(path.size)}`} className="size-full" shapeRendering="crispEdges" aria-hidden>
      <path d={path.d} fill={fg} />
    </svg>
  );
}

function ElementBody({
  el,
  orientation,
  data,
  groupLogo,
  edit,
}: {
  el: CertificateElement;
  orientation: CertificateLayout["page"]["orientation"];
  data: VariableData;
  groupLogo: string | null;
  edit: boolean;
}) {
  const pageW = PAGE_PT[orientation].w;
  const cqw = (pt: number) => `${String((pt / pageW) * 100)}cqw`;

  if (el.type === "text") return <TextBody el={el} data={data} cqw={cqw} />;

  if (el.type === "rect") {
    const rect: RectEl = el;
    return (
      <div
        className="size-full"
        style={{
          boxSizing: "border-box",
          background: rect.fill ? hexToRgba(rect.fill, rect.fillOpacity) : "transparent",
          border: rect.stroke && rect.strokeWidth > 0 ? `${cqw(rect.strokeWidth)} solid ${rect.stroke}` : undefined,
          borderRadius: cqw(rect.radius),
        }}
      />
    );
  }

  if (el.type === "image") {
    const image: ImageEl = el;
    const source = image.useGroupLogo ? groupLogo : image.ref;
    if (source) {
      return (
        <img
          src={imageSrc(source)}
          alt=""
          draggable={false}
          className="size-full"
          style={{ objectFit: image.fit, opacity: image.opacity }}
        />
      );
    }
    return (
      <div
        className={cn(
          "flex size-full flex-col items-center justify-center gap-1 border border-dashed text-center text-muted-foreground",
          edit ? "border-muted-foreground/60 bg-muted/40" : "border-muted-foreground/30",
        )}
        style={{ fontSize: cqw(10) }}
      >
        <ImageIcon className="size-[30%] max-h-6 max-w-6" aria-hidden />
        {edit && <span>{image.useGroupLogo ? "Logo do grupo" : "Imagem"}</span>}
      </div>
    );
  }

  const qr: QrEl = el;
  return (
    <div className="size-full bg-white" style={{ padding: "7%", boxSizing: "border-box" }}>
      <SampleQr fg={qr.fg} text={data.link} />
    </div>
  );
}

function TextBody({ el, data, cqw }: { el: TextEl; data: VariableData; cqw: (pt: number) => string }) {
  const font = fontDef(el.fontKey);
  return (
    <div
      className="flex size-full flex-col overflow-hidden"
      style={{ justifyContent: el.vAlign === "top" ? "flex-start" : el.vAlign === "bottom" ? "flex-end" : "center" }}
    >
      <div
        style={{
          fontFamily: font.css,
          fontSize: cqw(el.size),
          color: el.color,
          textAlign: el.align,
          lineHeight: el.lineHeight,
          letterSpacing: cqw(el.letterSpacing),
          textTransform: el.uppercase ? "uppercase" : "none",
          // Flag que a fonte não tem é IGNORADA (como no PDF): nada de negrito/itálico sintético.
          fontWeight: el.bold && font.bold ? 700 : 400,
          fontStyle: el.italic && font.italic ? "italic" : "normal",
          fontSynthesis: "none",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {applyVariables(el.text, data)}
      </div>
    </div>
  );
}

function ariaLabelOf(el: CertificateElement, index: number): string {
  const base = `${ELEMENT_TYPE_LABEL[el.type]} ${String(index + 1)}`;
  if (el.type !== "text") return el.type === "qr" ? `${base} (obrigatório, não pode ser removido)` : base;
  const snippet = el.text.replace(/\s+/g, " ").trim().slice(0, 40);
  return snippet ? `${base}: ${snippet}` : base;
}

interface DragState {
  pointerId: number;
  id: string;
  mode: "move" | Handle;
  startX: number;
  startY: number;
  width: number;
  height: number;
  base: CertificateLayout;
  last: CertificateLayout | null;
}

export interface CertificateCanvasProps {
  layout: CertificateLayout;
  variables: VariableData;
  /** "view" = só desenha (miniaturas); "edit" = selecionar, arrastar, redimensionar e usar o teclado. */
  mode?: "view" | "edit";
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Durante o arraste: o desenho provisório (não entra no histórico). `null` = gesto sem mudança (descarta). */
  onLiveChange?: (layout: CertificateLayout | null) => void;
  /** Fim do gesto/tecla: o desenho final (entra no histórico). `key` junta teclas repetidas num só passo. */
  onCommit?: (layout: CertificateLayout, options?: { key?: string }) => void;
  onDeleteElement?: (id: string) => void;
  /** Logo do grupo (para elementos "usar logo do grupo"). */
  groupLogo?: string | null | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
}

/**
 * A folha do certificado. Os elementos ficam em % da página; tamanhos de letra/borda em pt viram `cqw`
 * (relativos à largura da folha), então a prévia escala com a tela. O PDF do servidor é a referência final.
 */
export function CertificateCanvas({
  layout,
  variables,
  mode = "view",
  selectedId = null,
  onSelect,
  onLiveChange,
  onCommit,
  onDeleteElement,
  groupLogo = null,
  className,
  "aria-label": ariaLabel,
}: CertificateCanvasProps) {
  useLayoutFonts(layout);
  const edit = mode === "edit";
  const hintId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  const { orientation, background } = layout.page;
  const page = PAGE_PT[orientation];
  const boxes = useMemo(() => layout.elements.map((e) => elementBox(e, orientation)), [layout.elements, orientation]);

  function begin(event: PointerEvent<HTMLElement>, id: string, mode: DragState["mode"]) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const rect = sheet.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      base: layout,
      last: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onElementPointerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    if (!edit) return;
    event.stopPropagation();
    onSelect?.(id);
    if (event.pointerType === "mouse" && event.button !== 0) return;
    begin(event, id, "move");
  }

  function onHandlePointerDown(event: PointerEvent<HTMLSpanElement>, id: string, handle: Handle) {
    event.stopPropagation();
    event.preventDefault();
    onSelect?.(id);
    begin(event, id, handle);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || state.width === 0 || state.height === 0) return;
    const dx = ((event.clientX - state.startX) / state.width) * 100;
    const dy = ((event.clientY - state.startY) / state.height) * 100;
    const el = state.base.elements.find((e) => e.id === state.id);
    if (!el) return;
    const index = state.base.elements.findIndex((e) => e.id === state.id);
    const others = state.base.elements.map((e) => elementBox(e, orientation)).filter((_, i) => i !== index);

    let next: CertificateElement;
    let nextGuides: Guide[];
    if (state.mode === "move") {
      const moved = moveElement(el, dx, dy, orientation);
      const snap = snapMove(elementBox(moved, orientation), others);
      next = moveElement(moved, snap.dx, snap.dy, orientation);
      nextGuides = snap.guides;
    } else {
      const resized = resizeElement(el, state.mode, dx, dy, orientation);
      if (resized.type === "qr") {
        next = resized;
        nextGuides = [];
      } else {
        const snapped = snapResize(elementBox(resized, orientation), state.mode, others);
        next = { ...resized, ...snapped.box };
        nextGuides = snapped.guides;
      }
    }
    const nextLayout = replaceElement(state.base, next);
    state.last = nextLayout;
    setGuides(nextGuides);
    onLiveChange?.(nextLayout);
  }

  function finish(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    setGuides([]);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.last) onCommit?.(state.last);
    else onLiveChange?.(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, el: CertificateElement) {
    if (!edit || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 5 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = arrows[event.key];
    if (delta && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      // Alt + setas = redimensiona pelo canto inferior direito (alternativa por teclado às alças).
      const next = event.altKey
        ? resizeElement(el, "se", delta[0], delta[1], orientation)
        : moveElement(el, delta[0], delta[1], orientation);
      onCommit?.(replaceElement(layout, next), { key: `${event.altKey ? "size" : "move"}-${el.id}` });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDeleteElement?.(el.id);
    } else if (event.key === "Escape") {
      onSelect?.(null);
    }
  }

  const sheetStyle: CSSProperties = {
    aspectRatio: `${String(page.w)} / ${String(page.h)}`,
    containerType: "inline-size",
    backgroundColor: background.color,
  };

  return (
    <div
      ref={sheetRef}
      data-testid="certificate-sheet"
      data-orientation={orientation}
      role={edit ? "group" : "img"}
      aria-label={ariaLabel ?? (edit ? "Folha do certificado" : "Miniatura do modelo de certificado")}
      aria-describedby={edit ? hintId : undefined}
      className={cn("relative w-full select-none bg-white shadow-sm ring-1 ring-border", !edit && "overflow-hidden", className)}
      style={sheetStyle}
      onPointerDown={(event) => {
        if (edit && event.target === event.currentTarget) onSelect?.(null);
      }}
    >
      {edit && (
        <p id={hintId} className="sr-only">
          Use Tab para escolher um elemento. Setas movem 1%, com Shift movem 5%, com Alt mudam o tamanho. Delete remove o
          elemento (o QR Code não pode ser removido).
        </p>
      )}
      {background.imageRef && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `url("${imageSrc(background.imageRef)}")`,
            backgroundSize: background.imageFit === "contain" ? "contain" : "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}

      {layout.elements.map((el, index) => {
        const box: Box = boxes[index]!;
        const selected = edit && el.id === selectedId;
        const handles = el.type === "qr" ? QR_HANDLES : BOX_HANDLES;
        return (
          <div
            key={el.id}
            data-testid={`el-${el.id}`}
            data-element-type={el.type}
            data-selected={selected || undefined}
            {...(edit
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-pressed": selected,
                  "aria-label": ariaLabelOf(el, index),
                }
              : { "aria-hidden": true })}
            className={cn(
              "absolute",
              edit &&
                "touch-none cursor-move outline-offset-0 hover:outline hover:outline-1 hover:outline-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              selected && "outline outline-2 outline-primary",
              !edit && "pointer-events-none",
            )}
            style={{ left: `${String(box.x)}%`, top: `${String(box.y)}%`, width: `${String(box.w)}%`, height: `${String(box.h)}%` }}
            onPointerDown={(event) => onElementPointerDown(event, el.id)}
            onPointerMove={onPointerMove}
            onPointerUp={finish}
            onPointerCancel={finish}
            onFocus={() => edit && onSelect?.(el.id)}
            onKeyDown={(event) => onKeyDown(event, el)}
          >
            <ElementBody el={el} orientation={orientation} data={variables} groupLogo={groupLogo} edit={edit} />
            {selected &&
              handles.map((handle) => (
                <span
                  key={handle}
                  data-testid={`handle-${handle}`}
                  aria-hidden
                  title={`Redimensionar pelo ${HANDLE_NAME[handle]}`}
                  className={cn(
                    "absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 touch-none rounded-sm border border-primary bg-white",
                    // Área de toque >= 44px sem aumentar o desenho da alça.
                    "before:absolute before:-inset-4 before:content-['']",
                    HANDLE_STYLE[handle].cursor,
                  )}
                  style={HANDLE_STYLE[handle].style}
                  // move/up/cancel sobem (bolha) até o elemento, que já trata o gesto.
                  onPointerDown={(event) => onHandlePointerDown(event, el.id, handle)}
                />
              ))}
          </div>
        );
      })}

      {guides.map((guide) => (
        <div
          key={`${guide.axis}-${String(guide.pos)}`}
          data-testid={`guide-${guide.axis}`}
          aria-hidden
          className="pointer-events-none absolute bg-fuchsia-500"
          style={
            guide.axis === "x"
              ? { left: `${String(guide.pos)}%`, top: 0, bottom: 0, width: 1 }
              : { top: `${String(guide.pos)}%`, left: 0, right: 0, height: 1 }
          }
        />
      ))}
    </div>
  );
}
