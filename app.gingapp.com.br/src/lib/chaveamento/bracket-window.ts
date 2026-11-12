/** Geometria PURA para a chave no celular (sem DOM): janela visível (virtualização), rolagem até um cartão e menor rodada em foco. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Retângulo (em coordenadas da chave, antes da escala) que está na tela agora. */
export interface ViewWindow {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A partir de quantos cartões a chave só desenha o que está perto da tela (128 atletas = 127 lutas não travam o celular). */
export const VIRTUALIZE_MIN_CARDS = 48;

/** Arredonda a janela para fora em degraus: a lista de cartões só muda quando a rolagem passa de um degrau (menos renders). */
export function quantizeWindow(win: ViewWindow, stepX = 360, stepY = 480): ViewWindow {
  return {
    x0: Math.max(0, Math.floor(win.x0 / stepX) * stepX),
    x1: Math.ceil(win.x1 / stepX) * stepX,
    y0: Math.max(0, Math.floor(win.y0 / stepY) * stepY),
    y1: Math.ceil(win.y1 / stepY) * stepY,
  };
}

/** Cartões que encostam na janela (sem janela = todos). */
export function cardsInWindow<T extends Box>(cards: readonly T[], win: ViewWindow | null): T[] {
  if (win === null) return cards.slice();
  return cards.filter((c) => c.x + c.w >= win.x0 && c.x <= win.x1 && c.y + c.h >= win.y0 && c.y <= win.y1);
}

/** `scrollLeft` que deixa o cartão no centro da área visível (limitado ao que existe para rolar). */
export function scrollLeftToCenter(card: Pick<Box, "x" | "w">, scale: number, clientWidth: number, contentWidth: number): number {
  const wanted = (card.x + card.w / 2) * scale - clientWidth / 2;
  const max = Math.max(0, contentWidth * scale - clientWidth);
  return Math.max(0, Math.min(max, Math.round(wanted)));
}

/** O cartão está inteiro fora da janela visível (dica para mostrar "Ir para a luta ao vivo")? */
export function isOutsideWindow(card: Box, win: ViewWindow): boolean {
  return card.x + card.w < win.x0 || card.x > win.x1 || card.y + card.h < win.y0 || card.y > win.y1;
}

/** Escala que faz a chave caber na largura disponível (botão "Ajustar"); nunca menor que `min`. */
export function fitWidthScale(contentWidth: number, areaWidth: number, min = 0.3): number {
  if (contentWidth <= 0 || areaWidth <= 0) return 1;
  return Math.max(min, Math.min(1.6, areaWidth / contentWidth));
}

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 1.2;

export const clampZoom = (zoom: number): number => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
