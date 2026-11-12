import type { CropRect, NormalizedCrop, PhotoShape } from "./types";

/**
 * Matemática PURA do recorte (sem DOM). Modelo:
 *  - a janela de recorte é um quadrado de lado `viewport` (px de tela);
 *  - a imagem (já orientada) tem `width x height` px naturais;
 *  - zoom 1 = imagem em "cover" (o lado menor preenche a janela); zoom máximo = ZOOM_MAX;
 *  - `pan` = deslocamento do CENTRO da imagem em relação ao CENTRO da janela, em px de tela.
 * O pan é sempre limitado para a janela nunca ficar com área vazia.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const positive = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 1);

/** Zoom dentro de [ZOOM_MIN, ZOOM_MAX]; NaN vira o mínimo; ±Infinity vira o limite do lado correspondente. */
export function clampZoom(zoom: number): number {
  return Number.isNaN(zoom) ? ZOOM_MIN : clamp(zoom, ZOOM_MIN, ZOOM_MAX);
}

/** Escala (px de tela por px da imagem) que faz o lado menor cobrir a janela, com zoom 1. */
export function coverScale(image: Size, viewport: number): number {
  return positive(viewport) / Math.min(positive(image.width), positive(image.height));
}

/** Escala atual = cover x zoom. */
export function currentScale(image: Size, viewport: number, zoom: number): number {
  return coverScale(image, viewport) * clampZoom(zoom);
}

/** Maior deslocamento permitido em cada eixo (>= 0) para a janela continuar coberta. */
export function maxPan(image: Size, viewport: number, zoom: number): Point {
  const scale = currentScale(image, viewport, zoom);
  const v = positive(viewport);
  return {
    x: Math.max(0, (positive(image.width) * scale - v) / 2),
    y: Math.max(0, (positive(image.height) * scale - v) / 2),
  };
}

/** Limita o pan para a janela nunca mostrar área fora da imagem. */
export function clampPan(pan: Point, image: Size, viewport: number, zoom: number): Point {
  const limit = maxPan(image, viewport, zoom);
  return {
    x: clamp(finite(pan.x, 0), -limit.x, limit.x),
    y: clamp(finite(pan.y, 0), -limit.y, limit.y),
  };
}

/** Zoom e pan válidos (qualquer entrada vira um estado que cobre a janela). */
export function normalizeView(view: ViewState, image: Size, viewport: number): ViewState {
  const zoom = clampZoom(view.zoom);
  const pan = clampPan({ x: view.panX, y: view.panY }, image, viewport, zoom);
  return { zoom, panX: pan.x, panY: pan.y };
}

export const initialView = (): ViewState => ({ zoom: ZOOM_MIN, panX: 0, panY: 0 });

/**
 * Muda o zoom mantendo FIXO o ponto da imagem que está sob `anchor` (relativo ao CENTRO da janela):
 * serve à pinça, à roda do mouse e aos botões (âncora = centro).
 */
export function zoomAt(
  view: ViewState,
  nextZoom: number,
  anchor: Point,
  image: Size,
  viewport: number,
): ViewState {
  const current = normalizeView(view, image, viewport);
  const zoom = clampZoom(nextZoom);
  const ratio = currentScale(image, viewport, zoom) / currentScale(image, viewport, current.zoom);
  const ax = finite(anchor.x, 0);
  const ay = finite(anchor.y, 0);
  return normalizeView(
    { zoom, panX: ax - (ax - current.panX) * ratio, panY: ay - (ay - current.panY) * ratio },
    image,
    viewport,
  );
}

/** Desloca a imagem (delta em px de tela) respeitando os limites. */
export function panBy(
  view: ViewState,
  dx: number,
  dy: number,
  image: Size,
  viewport: number,
): ViewState {
  const current = normalizeView(view, image, viewport);
  return normalizeView(
    { ...current, panX: current.panX + finite(dx, 0), panY: current.panY + finite(dy, 0) },
    image,
    viewport,
  );
}

/** Região da imagem (px naturais) que está dentro da janela: sempre quadrada e dentro da imagem. */
export function cropRect(view: ViewState, image: Size, viewport: number): CropRect {
  const v = normalizeView(view, image, viewport);
  const scale = currentScale(image, viewport, v.zoom);
  const w = positive(image.width);
  const h = positive(image.height);
  const size = Math.min(positive(viewport) / scale, w, h);
  const centerX = w / 2 - v.panX / scale;
  const centerY = h / 2 - v.panY / scale;
  return {
    x: clamp(centerX - size / 2, 0, w - size),
    y: clamp(centerY - size / 2, 0, h - size),
    size,
  };
}

/** Ponto da janela (relativo ao canto superior esquerdo dela, em px de tela) -> ponto da imagem (px naturais). */
export function screenToImage(point: Point, view: ViewState, image: Size, viewport: number): Point {
  const v = normalizeView(view, image, viewport);
  const scale = currentScale(image, viewport, v.zoom);
  const half = positive(viewport) / 2;
  return {
    x: positive(image.width) / 2 + (point.x - half - v.panX) / scale,
    y: positive(image.height) / 2 + (point.y - half - v.panY) / scale,
  };
}

/** Inverso de `screenToImage`. */
export function imageToScreen(point: Point, view: ViewState, image: Size, viewport: number): Point {
  const v = normalizeView(view, image, viewport);
  const scale = currentScale(image, viewport, v.zoom);
  const half = positive(viewport) / 2;
  return {
    x: half + v.panX + (point.x - positive(image.width) / 2) * scale,
    y: half + v.panY + (point.y - positive(image.height) / 2) * scale,
  };
}

/** Retângulo e posição da imagem na tela (para desenhar): canto superior esquerdo relativo à janela e tamanho. */
export function imageBox(
  view: ViewState,
  image: Size,
  viewport: number,
): { left: number; top: number; width: number; height: number } {
  const v = normalizeView(view, image, viewport);
  const scale = currentScale(image, viewport, v.zoom);
  const width = positive(image.width) * scale;
  const height = positive(image.height) * scale;
  const half = positive(viewport) / 2;
  return { left: half + v.panX - width / 2, top: half + v.panY - height / 2, width, height };
}

/** Recorte centralizado (cover) quando a pessoa não ajustou nada. */
export function coverSquare(image: Size): CropRect {
  const w = positive(image.width);
  const h = positive(image.height);
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

export function toNormalized(rect: CropRect, image: Size): NormalizedCrop {
  const w = positive(image.width);
  const h = positive(image.height);
  return { x: rect.x / w, y: rect.y / h, width: rect.size / w, height: rect.size / h };
}

/** Frações -> retângulo quadrado em px de uma imagem de `image` (qualquer escala), sempre dentro dela. */
export function fromNormalized(crop: NormalizedCrop, image: Size): CropRect {
  const w = positive(image.width);
  const h = positive(image.height);
  const size = Math.max(
    1,
    Math.min(Math.round(Math.min(finite(crop.width, 1) * w, finite(crop.height, 1) * h)), w, h),
  );
  return {
    x: clamp(Math.round(finite(crop.x, 0) * w), 0, w - size),
    y: clamp(Math.round(finite(crop.y, 0) * h), 0, h - size),
    size,
  };
}

/** Distância entre dois dedos (pinça). */
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Ponto médio entre dois dedos. */
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// --- Escada de compressão ---------------------------------------------------------------------------------

/** Qualidade tentada em cada dimensão, da melhor para a pior. */
export const QUALITY_STEPS: readonly number[] = [0.9, 0.8, 0.7, 0.6, 0.5];
/** Lado do quadrado (`square`): 800 -> 600 -> 480. */
export const SQUARE_DIMENSIONS: readonly number[] = [800, 600, 480];
/** Lado maior de `wide`: parte de 1600 e desce até 640. */
export const WIDE_DIMENSIONS: readonly number[] = [1600, 1200, 900, 640];

export interface EncodeStep {
  quality: number;
  /** `square`: lado do quadrado; `wide`: lado maior. */
  dimension: number;
}

/**
 * Sequência de tentativas até caber em `maxBytes`: para cada dimensão (maior -> menor) a qualidade desce de 0,9 a 0,5;
 * só então a dimensão cai. Nunca amplia a imagem: dimensões acima de `sourceSide` são limitadas a ele (sem repetir).
 */
export function buildLadder(shape: PhotoShape, sourceSide: number): EncodeStep[] {
  const base = shape === "square" ? SQUARE_DIMENSIONS : WIDE_DIMENSIONS;
  const source = Math.max(1, Math.floor(positive(sourceSide)));
  const dims: number[] = [];
  for (const dim of base) {
    const capped = Math.min(dim, source);
    if (!dims.includes(capped)) dims.push(capped);
  }
  return dims.flatMap((dimension) => QUALITY_STEPS.map((quality) => ({ quality, dimension })));
}

/** Reduz para caber em `maxSide` no lado maior, sem ampliar; devolve inteiros >= 1. */
export function fitWithin(image: Size, maxSide: number): Size {
  const w = positive(image.width);
  const h = positive(image.height);
  const ratio = Math.min(1, positive(maxSide) / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

export interface DrawPlan {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dw: number;
  dh: number;
}

/** Parâmetros do `drawImage` para uma tentativa da escada. */
export function buildDrawPlan(
  shape: PhotoShape,
  image: Size,
  dimension: number,
  crop?: CropRect,
): DrawPlan {
  if (shape === "square") {
    const rect = crop ?? coverSquare(image);
    const side = Math.max(1, Math.min(Math.round(dimension), Math.floor(rect.size)));
    return { sx: rect.x, sy: rect.y, sw: rect.size, sh: rect.size, dw: side, dh: side };
  }
  const target = fitWithin(image, dimension);
  return {
    sx: 0,
    sy: 0,
    sw: positive(image.width),
    sh: positive(image.height),
    dw: target.width,
    dh: target.height,
  };
}

/** Lado de referência da imagem de origem para montar a escada (`square` = lado do recorte; `wide` = lado maior). */
export function sourceSideFor(shape: PhotoShape, image: Size, crop?: CropRect): number {
  if (shape === "square") return (crop ?? coverSquare(image)).size;
  return Math.max(positive(image.width), positive(image.height));
}
