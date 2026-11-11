import { roundLabel } from "./bracket-layout";
import type { PublicCategory, PublicCompetitor, PublicMatch } from "./types";

/** Frase única da luta para o leitor de tela (o conteúdo visual do cartão fica fora da árvore de acessibilidade). */
export function describeMatch(match: PublicMatch, byId: ReadonlyMap<number, PublicCompetitor>): string {
  const nameOf = (id: number | null, fallback: string): string => (id === null ? fallback : (byId.get(id)?.name ?? fallback));
  const a = nameOf(match.slotAId, "atleta a definir");
  const b = match.isBye ? "folga" : nameOf(match.slotBId, "atleta a definir");
  const mat = match.mat ? `, tatame ${match.mat}` : "";
  if (match.isBye) return `${a} avança direto (folga).`;
  switch (match.status) {
    case "LIVE":
      return `${a} contra ${b}, ao vivo${mat}.`;
    case "FINISHED": {
      const winner = match.winnerId === null ? null : (byId.get(match.winnerId)?.name ?? null);
      const score = match.scoreA !== null && match.scoreB !== null ? `, placar ${match.scoreA} a ${match.scoreB}` : "";
      return `${a} contra ${b}, terminou${score}. ${winner ? `${winner} venceu.` : match.resultType === "DRAW" ? "Empate." : ""}`.trim();
    }
    case "READY":
      return `${a} contra ${b}, aguardando${mat}.`;
    default:
      return `${a} contra ${b}, aguardando os atletas.`;
  }
}

/** "Grupo A", "Grupo B"... (índice 0-based; passando de Z, "Grupo 27"). */
export const groupLabel = (groupIndex: number): string => (groupIndex >= 0 && groupIndex < 26 ? `Grupo ${String.fromCharCode(65 + groupIndex)}` : `Grupo ${groupIndex + 1}`);

/**
 * Nome da fase de uma luta para o telão: "Final", "Semifinais", "Disputa de 3º lugar", "Grupo A · Rodada 2"...
 * `lastMainRound` = número da final do mata-mata da categoria (para nomear as rodadas pela distância até a final).
 */
export function matchStageLabel(match: Pick<PublicMatch, "stage" | "round" | "groupIndex">, lastMainRound: number): string {
  if (match.stage === "THIRD_PLACE") return "Disputa de 3º lugar";
  if (match.stage === "GROUP") {
    const round = `Rodada ${match.round}`;
    return match.groupIndex === null ? round : `${groupLabel(match.groupIndex)} · ${round}`;
  }
  return roundLabel(match.round, lastMainRound);
}

/** Formato da categoria em português para o cartão-título. */
export function formatLabel(format: PublicCategory["format"]): string {
  switch (format) {
    case "SINGLE_ELIMINATION":
      return "Eliminatória";
    case "ROUND_ROBIN":
      return "Todos contra todos";
    default:
      return "Grupos + mata-mata";
  }
}
