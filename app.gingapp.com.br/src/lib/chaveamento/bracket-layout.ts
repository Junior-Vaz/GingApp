import type { PublicMatch, Slot } from "./types";

/**
 * Geometria PURA da chave (sem DOM): colunas por rodada, posição de cada cartão e os conectores (cotovelos) que ligam
 * uma luta à seguinte por `nextMatchId`/`nextSlot`. A disputa de 3º lugar fica à parte, logo abaixo da final.
 * Funciona para 2..128 atletas (1 a 127 lutas no mata-mata). Nenhum cartão sobrepõe outro (garantido por construção).
 */

export type LayoutMatch = Pick<PublicMatch, "id" | "stage" | "round" | "position" | "nextMatchId" | "nextSlot">;

export interface LayoutOptions {
  cardW: number;
  cardH: number;
  /** Espaço horizontal entre colunas (onde passam os conectores). */
  colGap: number;
  /** Espaço vertical mínimo entre cartões da mesma coluna. */
  rowGap: number;
  /** Faixa superior para o título da coluna ("Quartas de final"). */
  headerH: number;
  padding: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { cardW: 236, cardH: 92, colGap: 64, rowGap: 18, headerH: 34, padding: 12 };

export interface BracketCard {
  matchId: number;
  round: number;
  stage: "MAIN" | "THIRD_PLACE";
  /** Índice da coluna (0 = primeira rodada). */
  column: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BracketConnector {
  fromMatchId: number;
  toMatchId: number;
  nextSlot: Slot | null;
  /** Saída (borda direita do cartão de origem) e entrada (borda esquerda do cartão seguinte, na altura do lado A ou B). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** `M x1 y1 H xm V y2 H x2`. */
  d: string;
}

export interface BracketColumn {
  round: number;
  column: number;
  x: number;
  label: string;
}

export interface BracketLayout {
  width: number;
  height: number;
  cards: BracketCard[];
  connectors: BracketConnector[];
  columns: BracketColumn[];
  /** Cartão da disputa de 3º lugar (se existir). */
  third: BracketCard | null;
}

/** "Final", "Semifinal", "Quartas de final", "Oitavas de final", "16 avos de final"..., senão "Rodada n". */
export function roundLabel(round: number, lastRound: number): string {
  const fromEnd = lastRound - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quartas de final";
  if (fromEnd === 3) return "Oitavas de final";
  if (fromEnd === 4) return "16 avos de final";
  if (fromEnd === 5) return "32 avos de final";
  return `Rodada ${round}`;
}

const bySlotAnchor = (h: number, slot: Slot | null): number => (slot === "A" ? h * 0.27 : slot === "B" ? h * 0.73 : h / 2);

export function computeBracketLayout(matches: readonly LayoutMatch[], options: Partial<LayoutOptions> = {}): BracketLayout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...options };
  const main = matches.filter((m) => m.stage === "MAIN");
  const thirdMatch = matches.find((m) => m.stage === "THIRD_PLACE") ?? null;

  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);
  const columnOf = new Map(rounds.map((r, i) => [r, i]));
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1]! : 1;

  const mainIds = new Set(main.map((m) => m.id));
  // Quem alimenta cada luta (pelo nextMatchId).
  const feeders = new Map<number, LayoutMatch[]>();
  for (const m of main) {
    if (m.nextMatchId !== null && mainIds.has(m.nextMatchId)) {
      const list = feeders.get(m.nextMatchId) ?? [];
      list.push(m);
      feeders.set(m.nextMatchId, list);
    }
  }

  const step = o.cardH + o.rowGap;
  const top = o.padding + o.headerH;
  const cards = new Map<number, BracketCard>();

  for (const round of rounds) {
    const column = columnOf.get(round)!;
    const inRound = main.filter((m) => m.round === round).sort((a, b) => a.position - b.position || a.id - b.id);
    // Posição ideal: primeira rodada em fila; as demais, no meio das duas lutas que as alimentam.
    const wanted = inRound.map((m, index) => {
      const fed = (feeders.get(m.id) ?? []).map((f) => cards.get(f.id)).filter((c): c is BracketCard => c !== undefined);
      if (column === 0 || fed.length === 0) return top + index * step;
      const centers = fed.map((c) => c.y + c.h / 2);
      return centers.reduce((s, v) => s + v, 0) / centers.length - o.cardH / 2;
    });
    // Garante espaço mínimo dentro da coluna (nenhum cartão cobre outro).
    let previousBottom = -Infinity;
    inRound.forEach((m, index) => {
      const y = Math.max(wanted[index]!, previousBottom + o.rowGap, top);
      previousBottom = y + o.cardH;
      cards.set(m.id, {
        matchId: m.id,
        round,
        stage: "MAIN",
        column,
        x: o.padding + column * (o.cardW + o.colGap),
        y,
        w: o.cardW,
        h: o.cardH,
      });
    });
  }

  const finalCard = [...cards.values()].find((c) => c.round === lastRound) ?? null;
  const columnCount = Math.max(rounds.length, 1);
  let third: BracketCard | null = null;
  if (thirdMatch) {
    const column = finalCard ? finalCard.column : Math.max(columnCount - 1, 0);
    third = {
      matchId: thirdMatch.id,
      round: thirdMatch.round,
      stage: "THIRD_PLACE",
      column,
      x: o.padding + column * (o.cardW + o.colGap),
      // Abaixo de TODOS os cartões da coluna da final (a final fica sozinha na última coluna).
      y:
        Math.max(
          top,
          ...[...cards.values()].filter((c) => c.column === column).map((c) => c.y + c.h),
        ) +
        o.rowGap * 3 +
        o.headerH * 0.6,
      w: o.cardW,
      h: o.cardH,
    };
  }

  const connectors: BracketConnector[] = [];
  for (const m of main) {
    if (m.nextMatchId === null) continue;
    const from = cards.get(m.id);
    const to = cards.get(m.nextMatchId);
    if (!from || !to) continue;
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + bySlotAnchor(to.h, m.nextSlot);
    const xm = x1 + (x2 - x1) / 2;
    connectors.push({ fromMatchId: m.id, toMatchId: to.matchId, nextSlot: m.nextSlot, x1, y1, x2, y2, d: `M ${x1} ${y1} H ${xm} V ${y2} H ${x2}` });
  }

  const all = [...cards.values(), ...(third ? [third] : [])];
  const width = o.padding * 2 + columnCount * o.cardW + (columnCount - 1) * o.colGap;
  const height = Math.max(top, ...all.map((c) => c.y + c.h)) + o.padding;
  const columns: BracketColumn[] = rounds.map((round, index) => ({
    round,
    column: index,
    x: o.padding + index * (o.cardW + o.colGap),
    label: roundLabel(round, lastRound),
  }));

  return { width, height, cards: [...cards.values(), ...(third ? [third] : [])], connectors, columns, third };
}

/**
 * Escala para a chave caber na área disponível (modo telão): nunca passa de `max` nem cai abaixo de `min`.
 * Área desconhecida (0) = escala 1.
 */
export function fitScale(
  content: { width: number; height: number },
  area: { width: number; height: number },
  bounds: { min: number; max: number } = { min: 0.15, max: 1.6 },
): number {
  if (area.width <= 0 || area.height <= 0 || content.width <= 0 || content.height <= 0) return 1;
  const raw = Math.min(area.width / content.width, area.height / content.height);
  return Math.min(bounds.max, Math.max(bounds.min, raw));
}
