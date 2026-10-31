/**
 * Funções PURAS do editor de modelos de certificado (sem React, sem rede): geometria, guias/snap, ordem,
 * duplicar, validação local (espelho do §2 do contrato) e substituição de variáveis para a prévia.
 */
import { fmt, verificationUrl } from "@/lib/format";
import { isUploadPath } from "@/lib/uploads";
import {
  ELEMENT_ID,
  ELEMENT_TYPE_LABEL,
  FONT_KEYS,
  HEX_COLOR,
  LIMITS,
  PAGE_PT,
  VARIABLE_KEYS,
  VERIFICATION_TOKENS,
  fontDef,
  type CertificateElement,
  type CertificateLayout,
  type ElementType,
  type FontKey,
  type ImageEl,
  type Orientation,
  type QrEl,
  type RectEl,
  type TextEl,
  type VariableKey,
} from "./types";

// ------------------------------------------------------------------ números e cores

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export const isHexColor = (value: unknown): boolean => typeof value === "string" && HEX_COLOR.test(value);

/** '#abc123' -> '#ABC123' (o contrato normaliza para maiúsculo); valor inválido passa como está. */
export const normalizeHex = (value: string): string => (HEX_COLOR.test(value) ? value.toUpperCase() : value);

/** Luminância relativa (WCAG) de '#RRGGBB', 0 (preto) a 1 (branco). */
export function relativeLuminance(hex: string): number {
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** A cor serve para o QR (escura o bastante)? */
export const isDarkEnoughForQr = (hex: string): boolean =>
  isHexColor(hex) && relativeLuminance(hex) <= LIMITS.qrMaxLuminance;

// ------------------------------------------------------------------ caixas (% da página)

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Caixa do elemento em % da página. O QR guarda o lado em pt: converte para % conforme a orientação. */
export function elementBox(el: CertificateElement, orientation: Orientation): Box {
  if (el.type === "qr") {
    const page = PAGE_PT[orientation];
    return { x: el.x, y: el.y, w: (el.size / page.w) * 100, h: (el.size / page.h) * 100 };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** Posição de início com o fim dentro da página (x + w <= 100) mesmo com erro de ponto flutuante. */
function fitStart(start: number, length: number): number {
  let value = round2(clamp(start, 0, Math.max(0, 100 - length)));
  while (value + length > 100 && value > 0) value = round2(value - 0.01);
  return Math.max(0, value);
}

/** Mantém a caixa dentro da página: w,h em [min,100] e x+w <= 100, y+h <= 100 (arredonda a 2 casas). */
export function clampBox(box: Box, min: number = LIMITS.minBox): Box {
  const w = round2(clamp(box.w, min, 100));
  const h = round2(clamp(box.h, min, 100));
  return { x: fitStart(box.x, w), y: fitStart(box.y, h), w, h };
}

function clampQr(el: QrEl, orientation: Orientation): QrEl {
  const page = PAGE_PT[orientation];
  const size = Math.round(clamp(el.size, LIMITS.qrSize.min, LIMITS.qrSize.max));
  return {
    ...el,
    size,
    x: fitStart(el.x, (size / page.w) * 100),
    y: fitStart(el.y, (size / page.h) * 100),
  };
}

/** Garante que o elemento cabe na página (e que os valores ficam dentro das faixas de caixa). */
export function clampElement<T extends CertificateElement>(el: T, orientation: Orientation): T {
  if (el.type === "qr") return clampQr(el, orientation) as T;
  const box = clampBox({ x: el.x, y: el.y, w: el.w, h: el.h });
  return { ...el, ...box };
}

export function moveElement<T extends CertificateElement>(el: T, dx: number, dy: number, orientation: Orientation): T {
  return clampElement({ ...el, x: el.x + dx, y: el.y + dy }, orientation);
}

// ------------------------------------------------------------------ redimensionar

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const BOX_HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const QR_HANDLES: readonly Handle[] = ["nw", "ne", "se", "sw"];
/** Tamanho mínimo ao arrastar uma alça (o contrato aceita 1; 2 evita caixas impossíveis de pegar). */
export const MIN_EDIT_BOX = 2;

/** Redimensiona pela alça: o lado oposto fica parado; a caixa nunca sai da página nem fica menor que `min`. */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, min: number = MIN_EDIT_BOX): Box {
  let l = box.x;
  let r = box.x + box.w;
  let t = box.y;
  let b = box.y + box.h;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  if (west) l += dx;
  if (east) r += dx;
  if (north) t += dy;
  if (south) b += dy;
  l = clamp(l, 0, 100);
  r = clamp(r, 0, 100);
  t = clamp(t, 0, 100);
  b = clamp(b, 0, 100);
  if ((west || east) && r - l < min) {
    if (west) l = r - min;
    else r = l + min;
  }
  if ((north || south) && b - t < min) {
    if (north) t = b - min;
    else b = t + min;
  }
  if (l < 0) {
    l = 0;
    r = Math.max(r, min);
  }
  if (t < 0) {
    t = 0;
    b = Math.max(b, min);
  }
  if (r > 100) {
    r = 100;
    l = Math.min(l, 100 - min);
  }
  if (b > 100) {
    b = 100;
    t = Math.min(t, 100 - min);
  }
  return clampBox({ x: l, y: t, w: r - l, h: b - t }, min);
}

/** QR é quadrado e o lado é em pt: só as alças dos cantos; o canto oposto fica parado. */
export function resizeQr(el: QrEl, handle: Handle, dx: number, dy: number, orientation: Orientation): QrEl {
  const page = PAGE_PT[orientation];
  const dxPt = (dx / 100) * page.w;
  const dyPt = (dy / 100) * page.h;
  const gx = handle.includes("e") ? dxPt : handle.includes("w") ? -dxPt : 0;
  const gy = handle.includes("s") ? dyPt : handle.includes("n") ? -dyPt : 0;
  const growth = Math.abs(gx) >= Math.abs(gy) ? gx : gy;
  const box = elementBox(el, orientation);
  // espaço disponível a partir do canto parado
  const maxX = handle.includes("e") ? ((100 - box.x) / 100) * page.w : ((box.x + box.w) / 100) * page.w;
  const maxY = handle.includes("s") ? ((100 - box.y) / 100) * page.h : ((box.y + box.h) / 100) * page.h;
  const size = Math.round(clamp(el.size + growth, LIMITS.qrSize.min, Math.max(LIMITS.qrSize.min, Math.min(LIMITS.qrSize.max, maxX, maxY))));
  const wPct = (size / page.w) * 100;
  const hPct = (size / page.h) * 100;
  const x = handle.includes("w") ? box.x + box.w - wPct : box.x;
  const y = handle.includes("n") ? box.y + box.h - hPct : box.y;
  return clampQr({ ...el, size, x, y }, orientation);
}

export function resizeElement<T extends CertificateElement>(
  el: T,
  handle: Handle,
  dx: number,
  dy: number,
  orientation: Orientation,
): T {
  if (el.type === "qr") return resizeQr(el, handle, dx, dy, orientation) as T;
  const next = resizeBox({ x: el.x, y: el.y, w: el.w, h: el.h }, handle, dx, dy);
  return { ...el, ...next };
}

// ------------------------------------------------------------------ guias / snap

/** Distância (em % da página) em que a caixa "gruda" numa guia. */
export const SNAP_THRESHOLD = 1;

export interface Guide {
  /** `x` = linha vertical em x%; `y` = linha horizontal em y%. */
  axis: "x" | "y";
  pos: number;
}

function lines(start: number, length: number): number[] {
  return [start, start + length / 2, start + length];
}

function nearest(values: number[], targets: number[], threshold: number): { delta: number } | null {
  let best: { delta: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const delta = t - v;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) best = { delta };
    }
  }
  return best;
}

/** Linhas-alvo: bordas e centro da página + bordas e centro das outras caixas. */
function targets(others: Box[], axis: "x" | "y"): number[] {
  const out = [0, 50, 100];
  for (const o of others) out.push(...(axis === "x" ? lines(o.x, o.w) : lines(o.y, o.h)));
  return out;
}

const EPS = 0.005;

function alignedGuides(values: number[], candidates: number[], axis: "x" | "y"): Guide[] {
  const found = new Set<number>();
  for (const v of values) for (const t of candidates) if (Math.abs(v - t) < EPS) found.add(round2(t));
  return [...found].map((pos) => ({ axis, pos }));
}

/** Move a caixa: devolve o ajuste (dx, dy) que a alinha às guias próximas e as guias acesas. */
export function snapMove(box: Box, others: Box[], threshold: number = SNAP_THRESHOLD): { dx: number; dy: number; guides: Guide[] } {
  const tx = targets(others, "x");
  const ty = targets(others, "y");
  const dx = nearest(lines(box.x, box.w), tx, threshold)?.delta ?? 0;
  const dy = nearest(lines(box.y, box.h), ty, threshold)?.delta ?? 0;
  const guides = [
    ...alignedGuides(lines(box.x + dx, box.w), tx, "x"),
    ...alignedGuides(lines(box.y + dy, box.h), ty, "y"),
  ];
  return { dx, dy, guides };
}

/** Redimensionamento: só as bordas que se movem grudam. */
export function snapResize(
  box: Box,
  handle: Handle,
  others: Box[],
  threshold: number = SNAP_THRESHOLD,
): { box: Box; guides: Guide[] } {
  const tx = targets(others, "x");
  const ty = targets(others, "y");
  let { x, y, w, h } = box;
  const guides: Guide[] = [];
  if (handle.includes("e")) {
    const d = nearest([x + w], tx, threshold)?.delta ?? 0;
    w += d;
    guides.push(...alignedGuides([x + w], tx, "x"));
  } else if (handle.includes("w")) {
    const d = nearest([x], tx, threshold)?.delta ?? 0;
    x += d;
    w -= d;
    guides.push(...alignedGuides([x], tx, "x"));
  }
  if (handle.includes("s")) {
    const d = nearest([y + h], ty, threshold)?.delta ?? 0;
    h += d;
    guides.push(...alignedGuides([y + h], ty, "y"));
  } else if (handle.includes("n")) {
    const d = nearest([y], ty, threshold)?.delta ?? 0;
    y += d;
    h -= d;
    guides.push(...alignedGuides([y], ty, "y"));
  }
  return { box: clampBox({ x, y, w, h }, MIN_EDIT_BOX), guides };
}

// ------------------------------------------------------------------ criar / alterar elementos

/** Ids novos: `e-xxxxxx` (a-z0-9, <= 40 chars) únicos no desenho. `random` é injetável nos testes. */
export function generateId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = `e-${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
    if (!used.has(id)) return id;
  }
  return `e-${String(used.size + 1)}-${String(Date.now())}`;
}

export const idsOf = (layout: CertificateLayout): string[] => layout.elements.map((e) => e.id);

export function defaultElement(type: ElementType, orientation: Orientation, id: string): CertificateElement {
  switch (type) {
    case "text":
      return clampElement(
        {
          id,
          type: "text",
          x: 20,
          y: 40,
          w: 60,
          h: 12,
          text: "Novo texto",
          fontKey: "helvetica",
          size: 24,
          color: "#1F2937",
          align: "center",
          vAlign: "middle",
          bold: false,
          italic: false,
          uppercase: false,
          letterSpacing: 0,
          lineHeight: 1.2,
        } satisfies TextEl,
        orientation,
      );
    case "image":
      return clampElement(
        { id, type: "image", x: 40, y: 8, w: 20, h: 20, ref: null, useGroupLogo: false, fit: "contain", opacity: 1 } satisfies ImageEl,
        orientation,
      );
    case "rect":
      return clampElement(
        {
          id,
          type: "rect",
          x: 10,
          y: 10,
          w: 30,
          h: 15,
          fill: "#E5E7EB",
          fillOpacity: 1,
          stroke: null,
          strokeWidth: 1,
          radius: 0,
        } satisfies RectEl,
        orientation,
      );
    case "qr":
      return clampElement({ id, type: "qr", x: 86, y: 78, size: 80, fg: "#000000" } satisfies QrEl, orientation);
  }
}

export function countImages(layout: CertificateLayout): number {
  return layout.elements.filter((e) => e.type === "image").length + (layout.page.background.imageRef ? 1 : 0);
}

/** Motivo (pt-BR) de NÃO poder inserir/duplicar um elemento deste tipo, ou `null` se pode. */
export function whyCannotAdd(layout: CertificateLayout, type: ElementType): string | null {
  if (type === "qr") return "O desenho já tem o QR Code (e só pode ter um).";
  if (layout.elements.length >= LIMITS.maxElements)
    return `O modelo já tem o máximo de ${String(LIMITS.maxElements)} elementos.`;
  if (type === "image" && countImages(layout) >= LIMITS.maxImages)
    return `O modelo já tem o máximo de ${String(LIMITS.maxImages)} imagens (o fundo conta).`;
  return null;
}

export function addElement(layout: CertificateLayout, el: CertificateElement): CertificateLayout {
  return { ...layout, elements: [...layout.elements, el] };
}

/** Cria e insere (no topo) um elemento padrão do tipo. Devolve `null` se o limite/regra não permite. */
export function addDefaultElement(
  layout: CertificateLayout,
  type: ElementType,
  random?: () => number,
): { layout: CertificateLayout; id: string } | null {
  if (whyCannotAdd(layout, type)) return null;
  const id = generateId(idsOf(layout), random);
  return { layout: addElement(layout, defaultElement(type, layout.page.orientation, id)), id };
}

export function getElement(layout: CertificateLayout, id: string | null): CertificateElement | undefined {
  return id === null ? undefined : layout.elements.find((e) => e.id === id);
}

/**
 * Altera campos do elemento. Regras: trocar para uma fonte sem negrito/itálico desliga a flag; cor do QR e
 * caixas passam pelo clamp (nunca sai da página). Id inexistente = o mesmo desenho.
 */
export function updateElement(
  layout: CertificateLayout,
  id: string,
  patch: Partial<TextEl> | Partial<ImageEl> | Partial<RectEl> | Partial<QrEl>,
): CertificateLayout {
  const current = getElement(layout, id);
  if (!current) return layout;
  let next = { ...current, ...patch, id: current.id, type: current.type } as CertificateElement;
  if (next.type === "text") {
    const font = fontDef(next.fontKey);
    next = { ...next, bold: next.bold && font.bold, italic: next.italic && font.italic };
  }
  next = clampElement(next, layout.page.orientation);
  return { ...layout, elements: layout.elements.map((e) => (e.id === id ? next : e)) };
}

/** Troca o elemento inteiro (usado ao arrastar). */
export function replaceElement(layout: CertificateLayout, el: CertificateElement): CertificateLayout {
  return { ...layout, elements: layout.elements.map((e) => (e.id === el.id ? el : e)) };
}

/** Remove o elemento. O QR NUNCA é removido (devolve o mesmo desenho). */
export function removeElement(layout: CertificateLayout, id: string): CertificateLayout {
  const current = getElement(layout, id);
  if (!current || current.type === "qr") return layout;
  return { ...layout, elements: layout.elements.filter((e) => e.id !== id) };
}

/** Copia o elemento (logo acima do original, deslocada 2%). QR não duplica; limites também valem. */
export function duplicateElement(
  layout: CertificateLayout,
  id: string,
  random?: () => number,
): { layout: CertificateLayout; id: string } | null {
  const source = getElement(layout, id);
  if (!source || whyCannotAdd(layout, source.type)) return null;
  const copyId = generateId(idsOf(layout), random);
  const copy = clampElement({ ...source, id: copyId, x: source.x + 2, y: source.y + 2 }, layout.page.orientation);
  const index = layout.elements.findIndex((e) => e.id === id);
  const elements = [...layout.elements];
  elements.splice(index + 1, 0, copy);
  return { layout: { ...layout, elements }, id: copyId };
}

export type OrderAction = "front" | "back" | "forward" | "backward";

/** Ordem de empilhamento (o último da lista fica por cima). */
export function reorderElement(layout: CertificateLayout, id: string, action: OrderAction): CertificateLayout {
  const from = layout.elements.findIndex((e) => e.id === id);
  if (from < 0) return layout;
  const last = layout.elements.length - 1;
  const to =
    action === "front" ? last : action === "back" ? 0 : action === "forward" ? Math.min(last, from + 1) : Math.max(0, from - 1);
  if (to === from) return layout;
  const elements = [...layout.elements];
  const [moved] = elements.splice(from, 1);
  elements.splice(to, 0, moved!);
  return { ...layout, elements };
}

export function canReorder(layout: CertificateLayout, id: string, action: OrderAction): boolean {
  const index = layout.elements.findIndex((e) => e.id === id);
  if (index < 0) return false;
  const last = layout.elements.length - 1;
  return action === "front" || action === "forward" ? index < last : index > 0;
}

// ------------------------------------------------------------------ página

export function setOrientation(layout: CertificateLayout, orientation: Orientation): CertificateLayout {
  if (layout.page.orientation === orientation) return layout;
  const next: CertificateLayout = { ...layout, page: { ...layout.page, orientation } };
  // As posições são em %: continuam as mesmas; só garante que tudo cabe (o QR tem lado em pt).
  return { ...next, elements: next.elements.map((e) => clampElement(e, orientation)) };
}

export function setBackground(
  layout: CertificateLayout,
  patch: Partial<CertificateLayout["page"]["background"]>,
): CertificateLayout {
  return { ...layout, page: { ...layout.page, background: { ...layout.page.background, ...patch } } };
}

// ------------------------------------------------------------------ variáveis

export type VariableData = Record<VariableKey, string>;

const VARIABLE_PATTERN = /\{([^{}]*)\}/g;

/** Dados de exemplo (§3): aluno, título, graduação, código e link fixos; grupo real; data = hoje. */
export function sampleVariables(groupName?: string | null, now: Date = new Date()): VariableData {
  return {
    aluno: "Maria da Silva Santos",
    grupo: groupName?.trim() || "Seu grupo",
    titulo: "Batizado e troca de corda",
    graduacao: "Corda Verde",
    data: fmt(now, "dd/MM/yyyy"),
    dataExtenso: fmt(now, "d 'de' MMMM 'de' yyyy"),
    codigo: "EXEMPLO-0000",
    link: verificationUrl("EXEMPLO-0000"),
  };
}

/** Troca as variáveis conhecidas pelos valores; as desconhecidas ficam como estão (a validação as aponta). */
export function applyVariables(text: string, data: VariableData): string {
  return text.replace(VARIABLE_PATTERN, (match, name: string) =>
    VARIABLE_KEYS.includes(name) ? data[name as VariableKey] : match,
  );
}

/** Variáveis desconhecidas (`{xyz}`) e se sobrou `{`/`}` solto. */
export function analyzeVariables(text: string): { unknown: string[]; stray: boolean } {
  const unknown: string[] = [];
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!VARIABLE_KEYS.includes(match[1] ?? "")) unknown.push(match[0]);
  }
  return { unknown, stray: /[{}]/.test(text.replace(VARIABLE_PATTERN, "")) };
}

export const hasVerificationToken = (text: string): boolean => VERIFICATION_TOKENS.some((t) => text.includes(t));

/** Insere `token` na posição do cursor (ou troca a seleção). */
export function insertAtCursor(
  text: string,
  token: string,
  selectionStart: number,
  selectionEnd: number,
): { text: string; cursor: number } {
  const start = clamp(selectionStart, 0, text.length);
  const end = clamp(selectionEnd, start, text.length);
  return { text: text.slice(0, start) + token + text.slice(end), cursor: start + token.length };
}

// ------------------------------------------------------------------ formato do fio (só as chaves do contrato)

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Converte para EXATAMENTE as chaves do contrato (campo extra = 400 no backend), com cores em maiúsculo e
 * valores opcionais preenchidos. Serve para salvar, pré-visualizar e comparar "alterado?".
 */
export function toWireLayout(layout: CertificateLayout): CertificateLayout {
  const background = layout.page.background;
  return {
    version: 1,
    page: {
      orientation: layout.page.orientation,
      background: {
        color: normalizeHex(background.color),
        imageRef: background.imageRef ? background.imageRef : null,
        imageFit: background.imageFit ?? "cover",
      },
    },
    elements: layout.elements.map((el): CertificateElement => {
      switch (el.type) {
        case "text":
          return {
            id: el.id,
            type: "text",
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            text: el.text,
            fontKey: el.fontKey,
            size: el.size,
            color: normalizeHex(el.color),
            align: el.align,
            vAlign: el.vAlign,
            bold: !!el.bold,
            italic: !!el.italic,
            uppercase: !!el.uppercase,
            letterSpacing: num(el.letterSpacing, 0),
            lineHeight: num(el.lineHeight, 1.2),
          };
        case "image":
          return {
            id: el.id,
            type: "image",
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            ref: el.ref ? el.ref : null,
            useGroupLogo: !!el.useGroupLogo,
            fit: el.fit,
            opacity: num(el.opacity, 1),
          };
        case "rect":
          return {
            id: el.id,
            type: "rect",
            x: el.x,
            y: el.y,
            w: el.w,
            h: el.h,
            fill: el.fill ? normalizeHex(el.fill) : null,
            fillOpacity: num(el.fillOpacity, 1),
            stroke: el.stroke ? normalizeHex(el.stroke) : null,
            strokeWidth: num(el.strokeWidth, 0),
            radius: num(el.radius, 0),
          };
        case "qr":
          return { id: el.id, type: "qr", x: el.x, y: el.y, size: el.size, fg: normalizeHex(el.fg) };
      }
    }),
  };
}

export const layoutSignature = (layout: CertificateLayout): string => JSON.stringify(toWireLayout(layout));

/** Tamanho em bytes do JSON enviado (limite de 64 KB). */
export const layoutBytes = (layout: CertificateLayout): number =>
  new TextEncoder().encode(JSON.stringify(toWireLayout(layout))).length;

// ------------------------------------------------------------------ validação local (§2)

export interface LayoutIssue {
  /** Elemento com problema (se houver): o editor seleciona ao clicar. */
  elementId?: string;
  message: string;
}

const inRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const TOL = 1e-6;

/** Nome curto do elemento nas mensagens: "Texto 2". */
export function elementLabel(layout: CertificateLayout, id: string): string {
  const index = layout.elements.findIndex((e) => e.id === id);
  const el = layout.elements[index];
  return el ? `${ELEMENT_TYPE_LABEL[el.type]} ${String(index + 1)}` : "Elemento";
}

/**
 * Valida o desenho como o backend (400 lá, aqui o editor impede). Mensagens em português, indicando o elemento.
 * Lista vazia = pode salvar.
 */
export function validateLayout(layout: CertificateLayout): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const add = (message: string, elementId?: string) => issues.push(elementId ? { elementId, message } : { message });

  if (layout.version !== 1) add("Versão do desenho não suportada.");
  if (layout.page.orientation !== "landscape" && layout.page.orientation !== "portrait")
    add("Orientação inválida: use paisagem ou retrato.");

  const bg = layout.page.background;
  if (!isHexColor(bg.color)) add("A cor de fundo precisa estar no formato #RRGGBB.");
  if (bg.imageFit !== undefined && bg.imageFit !== "cover" && bg.imageFit !== "contain")
    add("O ajuste da imagem de fundo é inválido.");
  if (bg.imageRef && !isUploadPath(bg.imageRef)) add("A imagem de fundo precisa ser uma imagem enviada pelo painel.");

  const { elements } = layout;
  if (elements.length < 1) add("O modelo precisa de pelo menos 1 elemento.");
  if (elements.length > LIMITS.maxElements) add(`O modelo pode ter no máximo ${String(LIMITS.maxElements)} elementos.`);
  if (countImages(layout) > LIMITS.maxImages)
    add(`O modelo pode ter no máximo ${String(LIMITS.maxImages)} imagens (o fundo conta).`);

  const qrs = elements.filter((e) => e.type === "qr");
  if (qrs.length !== 1) add(qrs.length === 0 ? "O modelo precisa do QR Code de verificação." : "O modelo só pode ter um QR Code.");
  if (!elements.some((e) => e.type === "text" && hasVerificationToken(e.text)))
    add("Inclua em algum texto a variável {codigo} ou {link} para o certificado poder ser verificado.");

  const seen = new Set<string>();
  elements.forEach((el, index) => {
    const label = `${ELEMENT_TYPE_LABEL[el.type]} ${String(index + 1)}`;
    const fail = (message: string) => add(`${label}: ${message}`, el.id);

    if (!ELEMENT_ID.test(el.id)) fail("identificador inválido.");
    if (seen.has(el.id)) fail("identificador repetido.");
    seen.add(el.id);

    if (el.type === "qr") {
      if (!inRange(el.size, LIMITS.qrSize.min, LIMITS.qrSize.max))
        fail(`o tamanho precisa ficar entre ${String(LIMITS.qrSize.min)} e ${String(LIMITS.qrSize.max)} pt.`);
      if (!isHexColor(el.fg)) fail("a cor do QR precisa estar no formato #RRGGBB.");
      else if (!isDarkEnoughForQr(el.fg)) fail("a cor do QR é clara demais; escolha uma cor escura para ele ser lido.");
      const box = elementBox(el, layout.page.orientation);
      if (!inRange(el.x, 0, 100) || !inRange(el.y, 0, 100) || box.x + box.w > 100 + TOL || box.y + box.h > 100 + TOL)
        fail("o QR Code precisa caber dentro da página.");
      return;
    }

    if (
      !inRange(el.x, 0, 100) ||
      !inRange(el.y, 0, 100) ||
      !inRange(el.w, LIMITS.minBox, 100) ||
      !inRange(el.h, LIMITS.minBox, 100) ||
      el.x + el.w > 100 + TOL ||
      el.y + el.h > 100 + TOL
    )
      fail("a caixa precisa ficar dentro da página (largura e altura de pelo menos 1%).");

    if (el.type === "text") {
      if (el.text.trim().length === 0) fail("o texto não pode ficar vazio.");
      else if (el.text.length > LIMITS.maxText) fail(`o texto pode ter no máximo ${String(LIMITS.maxText)} caracteres.`);
      const vars = analyzeVariables(el.text);
      if (vars.unknown.length > 0)
        fail(`variável desconhecida ${[...new Set(vars.unknown)].join(", ")}. Use ${VARIABLE_KEYS.map((k) => `{${k}}`).join(", ")}.`);
      if (vars.stray) fail("há { ou } solto no texto. Use as chaves só nas variáveis, como {aluno}.");
      if (!FONT_KEYS.includes(el.fontKey as FontKey)) fail("fonte desconhecida.");
      if (!inRange(el.size, LIMITS.fontSize.min, LIMITS.fontSize.max))
        fail(`o tamanho da letra precisa ficar entre ${String(LIMITS.fontSize.min)} e ${String(LIMITS.fontSize.max)} pt.`);
      if (!isHexColor(el.color)) fail("a cor do texto precisa estar no formato #RRGGBB.");
      if (!["left", "center", "right"].includes(el.align)) fail("alinhamento inválido.");
      if (!["top", "middle", "bottom"].includes(el.vAlign)) fail("alinhamento vertical inválido.");
      if (!inRange(el.letterSpacing, LIMITS.letterSpacing.min, LIMITS.letterSpacing.max))
        fail(`o espaçamento entre letras precisa ficar entre ${String(LIMITS.letterSpacing.min)} e ${String(LIMITS.letterSpacing.max)} pt.`);
      if (!inRange(el.lineHeight, LIMITS.lineHeight.min, LIMITS.lineHeight.max))
        fail(`a entrelinha precisa ficar entre ${String(LIMITS.lineHeight.min)} e ${String(LIMITS.lineHeight.max)}.`);
    } else if (el.type === "image") {
      if (el.ref && !isUploadPath(el.ref)) fail("a imagem precisa ser uma imagem enviada pelo painel.");
      if (el.fit !== "contain" && el.fit !== "cover") fail("ajuste da imagem inválido.");
      if (!inRange(el.opacity, 0, 1)) fail("a opacidade precisa ficar entre 0 e 100%.");
    } else {
      if (el.fill !== null && !isHexColor(el.fill)) fail("a cor de preenchimento precisa estar no formato #RRGGBB.");
      if (el.stroke !== null && !isHexColor(el.stroke)) fail("a cor da borda precisa estar no formato #RRGGBB.");
      if (!inRange(el.fillOpacity, 0, 1)) fail("a opacidade do preenchimento precisa ficar entre 0 e 100%.");
      if (!inRange(el.strokeWidth, LIMITS.strokeWidth.min, LIMITS.strokeWidth.max))
        fail(`a espessura da borda precisa ficar entre ${String(LIMITS.strokeWidth.min)} e ${String(LIMITS.strokeWidth.max)} pt.`);
      if (!inRange(el.radius, LIMITS.radius.min, LIMITS.radius.max))
        fail(`o raio dos cantos precisa ficar entre ${String(LIMITS.radius.min)} e ${String(LIMITS.radius.max)} pt.`);
    }
  });

  if (layoutBytes(layout) > LIMITS.maxLayoutBytes) add("O desenho passou de 64 KB: remova alguns elementos ou textos longos.");
  return issues;
}

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Informe o nome do modelo.";
  if (trimmed.length > LIMITS.nameMax) return `O nome pode ter no máximo ${String(LIMITS.nameMax)} caracteres.`;
  return null;
}

// ------------------------------------------------------------------ desenho em branco

/** Modelo em branco VÁLIDO: fundo branco, uma linha de verificação e o QR (o mínimo que o contrato exige). */
export function blankLayout(orientation: Orientation = "landscape"): CertificateLayout {
  const layout: CertificateLayout = {
    version: 1,
    page: { orientation, background: { color: "#FFFFFF", imageRef: null, imageFit: "cover" } },
    elements: [],
  };
  const text = {
    ...(defaultElement("text", orientation, "texto-principal") as TextEl),
    x: 10,
    y: 40,
    w: 80,
    h: 20,
    text: "{aluno}",
    size: 36,
  } satisfies TextEl;
  const verify = {
    ...(defaultElement("text", orientation, "texto-verificacao") as TextEl),
    x: 6,
    y: 88,
    w: 70,
    h: 6,
    text: "Código de verificação: {codigo}",
    size: 10,
    align: "left",
    vAlign: "middle",
  } satisfies TextEl;
  return { ...layout, elements: [text, verify, defaultElement("qr", orientation, "qr-verificacao")] };
}

/** Tipos que o botão "Adicionar" cria (o QR já existe e não se duplica). */
export const ADDABLE_TYPES: readonly Exclude<ElementType, "qr">[] = ["text", "image", "rect"];
