import type { OperatorMatch } from "./types";

/**
 * Geometria da chave eliminatória (SVG): funções PURAS, sem React. Cada rodada é uma coluna; uma luta de rodada
 * posterior fica centrada entre as lutas que alimentam ela (via `nextMatchId`), e os conectores ligam cada luta à
 * próxima, no lado (A/B) certo. A disputa de 3º lugar fica separada, abaixo da última coluna.
 */

export const ROW_H = 44; // alvo de toque de 44 px por atleta
export const FOOT_H = 22;
export const CARD_W = 248;
export const CARD_H = ROW_H * 2 + FOOT_H;
export const COL_GAP = 52;
export const ROW_GAP = 14;
export const PAD = 14;
/** Respiro acima da 1ª linha (os nomes das rodadas ficam num cabeçalho fixo FORA do desenho). */
export const HEADER_H = 12;
/** Espaço entre o fim da chave e o cartão do 3º lugar (cabe o título "Disputa de 3º lugar"). */
export const THIRD_GAP = 52;

export interface PositionedMatch {
  match: OperatorMatch;
  x: number;
  y: number;
  /** Índice da coluna (0 = 1ª rodada). O 3º lugar usa a última coluna. */
  column: number;
}

export interface BracketEdge {
  fromId: number;
  toId: number;
  slot: "A" | "B";
  /** Caminho SVG do conector (do lado direito da luta de origem ao lado esquerdo da luta seguinte). */
  d: string;
}

export interface BracketColumn {
  round: number;
  x: number;
  label: string;
}

export interface BracketLayout {
  nodes: PositionedMatch[];
  third: PositionedMatch | null;
  /** Posição do título "Disputa de 3º lugar". */
  thirdLabelY: number | null;
  edges: BracketEdge[];
  columns: BracketColumn[];
  width: number;
  height: number;
}

/**
 * Nomes das rodadas em português, contados a partir da final (os mesmos do telão público): Final, Semifinais, Quartas
 * de final, Oitavas de final, 16 avos de final, 32 avos de final. Em chaves muito grandes a 1ª rodada vira "1ª rodada".
 */
export function roundLabel(round: number, lastRound: number): string {
  const fromEnd = lastRound - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinais";
  if (fromEnd === 2) return "Quartas de final";
  if (fromEnd === 3) return "Oitavas de final";
  if (fromEnd >= 5 && round === 1) return "1ª rodada";
  if (fromEnd === 4) return "16 avos de final";
  if (fromEnd === 5) return "32 avos de final";
  return `Rodada ${String(round)}`;
}

/** Centro vertical do lado A/B de uma luta (onde o conector encosta). */
export const slotCenterY = (y: number, slot: "A" | "B"): number => y + (slot === "A" ? ROW_H / 2 : ROW_H + ROW_H / 2);

export function layoutBracket(matches: readonly OperatorMatch[]): BracketLayout {
  const main = matches.filter((m) => m.stage === "MAIN");
  const thirdMatch = matches.find((m) => m.stage === "THIRD_PLACE") ?? null;
  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);
  const lastRound = rounds[rounds.length - 1] ?? 1;
  const colX = (index: number) => PAD + index * (CARD_W + COL_GAP);

  const placed = new Map<number, PositionedMatch>();
  rounds.forEach((round, column) => {
    const inRound = main.filter((m) => m.round === round).sort((a, b) => a.position - b.position || a.id - b.id);
    const wanted = inRound.map((m, i) => {
      const feeders = main.filter((f) => f.nextMatchId === m.id).map((f) => placed.get(f.id)).filter((p): p is PositionedMatch => p !== undefined);
      if (feeders.length > 0) {
        // Todos os cartões têm a mesma altura: a média dos topos centraliza entre as lutas que alimentam esta.
        return feeders.reduce((sum, p) => sum + p.y, 0) / feeders.length;
      }
      // Sem lutas anteriores (1ª rodada, ou chave incompleta): empilha por posição, espaçando como a coluna 0.
      return HEADER_H + (column === 0 ? i : m.position * 2 ** column) * (CARD_H + ROW_GAP);
    });
    // Garante que nada se sobreponha na coluna (mantém a ordem por posição).
    let floor = HEADER_H;
    inRound.forEach((m, i) => {
      const y = Math.max(wanted[i] ?? floor, floor);
      floor = y + CARD_H + ROW_GAP;
      placed.set(m.id, { match: m, x: colX(column), y, column });
    });
  });

  const nodes = [...placed.values()].sort((a, b) => a.column - b.column || a.y - b.y);
  const bottom = nodes.reduce((max, n) => Math.max(max, n.y + CARD_H), HEADER_H);

  let third: PositionedMatch | null = null;
  let thirdLabelY: number | null = null;
  let height = bottom + PAD;
  if (thirdMatch) {
    const column = Math.max(rounds.length - 1, 0);
    thirdLabelY = bottom + THIRD_GAP - 12;
    third = { match: thirdMatch, x: colX(column), y: bottom + THIRD_GAP, column };
    height = third.y + CARD_H + PAD;
  }

  const edges: BracketEdge[] = [];
  for (const n of nodes) {
    const nextId = n.match.nextMatchId;
    const slot = n.match.nextSlot;
    if (nextId === null || slot === null) continue;
    const target = placed.get(nextId);
    if (!target) continue;
    const x1 = n.x + CARD_W;
    const y1 = n.y + ROW_H; // meio entre as duas linhas de atleta (o rodapé de status fica abaixo)
    const x2 = target.x;
    const y2 = slotCenterY(target.y, slot);
    const mid = x1 + COL_GAP / 2;
    edges.push({ fromId: n.match.id, toId: target.match.id, slot, d: `M ${String(x1)} ${String(y1)} H ${String(mid)} V ${String(y2)} H ${String(x2)}` });
  }

  const columns: BracketColumn[] = rounds.map((round, column) => ({ round, x: colX(column), label: roundLabel(round, lastRound) }));
  const cols = Math.max(rounds.length, 1);
  return {
    nodes,
    third,
    thirdLabelY,
    edges,
    columns,
    width: PAD * 2 + cols * CARD_W + (cols - 1) * COL_GAP,
    height,
  };
}

/** Dois retângulos de cartão se sobrepõem? (usado pelos testes de geometria) */
export function overlaps(a: Pick<PositionedMatch, "x" | "y">, b: Pick<PositionedMatch, "x" | "y">): boolean {
  return a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + CARD_H && b.y < a.y + CARD_H;
}
