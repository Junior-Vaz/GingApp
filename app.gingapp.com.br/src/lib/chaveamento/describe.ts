import type { PublicCompetitor, PublicMatch } from "./types";

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
