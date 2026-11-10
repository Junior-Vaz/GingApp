import { DEFAULT_STANDING_RULES, Id, MatchResult, StandingRow, StandingRules } from './types';

interface Acc {
  competitorId: Id;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number;
}

interface Decided {
  a: Id;
  b: Id;
  /** null = empate */
  winner: Id | null;
}

/**
 * Classificação (contrato §3, item 4).
 * Vitória/empate/derrota pelos `rules` (3/1/0). W.O. e desclassificação = vitória do adversário.
 * Saldo/pró/contra usam os scores quando existirem (null conta 0), inclusive em W.O.
 * Resultado sem vencedor e que não é DRAW (luta não decidida) é ignorado, assim como resultados de atletas fora de `ids`.
 *
 * Desempate: pontos -> vitórias -> saldo -> pró -> confronto direto (só entre exatamente 2 empatados)
 * -> menor seed (null/ausente por último) -> menor id. `seedById` é opcional (a assinatura base só recebe ids).
 * `rank` 1..n único.
 */
export function computeStandings(
  ids: Id[],
  results: MatchResult[],
  rules: StandingRules = DEFAULT_STANDING_RULES,
  seedById?: ReadonlyMap<Id, number | null>,
): StandingRow[] {
  const rows = new Map<Id, Acc>();
  for (const id of ids) {
    if (!rows.has(id)) {
      rows.set(id, { competitorId: id, played: 0, wins: 0, draws: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, points: 0 });
    }
  }

  const decided: Decided[] = [];
  for (const r of results) {
    const a = rows.get(r.slotA);
    const b = rows.get(r.slotB);
    if (!a || !b || r.slotA === r.slotB) continue;
    const isDraw = r.resultType === 'DRAW';
    const aWon = !isDraw && r.winnerId === r.slotA;
    const bWon = !isDraw && r.winnerId === r.slotB;
    if (!isDraw && !aWon && !bWon) continue; // luta não decidida

    // Contrato §3: W.O. e desclassificação contam a vitória, mas NÃO entram no saldo/pró/contra.
    const countsScore = r.resultType === 'NORMAL' || r.resultType === 'DRAW';
    const sa = countsScore ? (r.scoreA ?? 0) : 0;
    const sb = countsScore ? (r.scoreB ?? 0) : 0;
    a.played++;
    b.played++;
    a.pointsFor += sa;
    a.pointsAgainst += sb;
    b.pointsFor += sb;
    b.pointsAgainst += sa;
    if (isDraw) {
      a.draws++;
      b.draws++;
      a.points += rules.pointsDraw;
      b.points += rules.pointsDraw;
      decided.push({ a: r.slotA, b: r.slotB, winner: null });
    } else {
      const win = aWon ? a : b;
      const lose = aWon ? b : a;
      win.wins++;
      win.points += rules.pointsWin;
      lose.losses++;
      lose.points += rules.pointsLoss;
      decided.push({ a: r.slotA, b: r.slotB, winner: win.competitorId });
    }
  }

  const seedOf = (id: Id): number => {
    const s = seedById?.get(id);
    return s === null || s === undefined ? Number.POSITIVE_INFINITY : s;
  };
  const diff = (x: Acc) => x.pointsFor - x.pointsAgainst;

  const sorted = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.wins - x.wins ||
      diff(y) - diff(x) ||
      y.pointsFor - x.pointsFor ||
      compareNumber(seedOf(x.competitorId), seedOf(y.competitorId)) ||
      x.competitorId - y.competitorId,
  );

  // Confronto direto: só quando EXATAMENTE 2 estão empatados em pontos, vitórias, saldo e pró.
  const tied = (x: Acc, y: Acc) =>
    x.points === y.points && x.wins === y.wins && diff(x) === diff(y) && x.pointsFor === y.pointsFor;
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && tied(sorted[i], sorted[j])) j++;
    if (j - i === 2) {
      const first = sorted[i];
      const second = sorted[i + 1];
      if (headToHead(decided, second.competitorId, first.competitorId) > 0) {
        sorted[i] = second;
        sorted[i + 1] = first;
      }
    }
    i = j;
  }

  return sorted.map((x, idx) => ({ ...x, rank: idx + 1 }));
}

function compareNumber(a: number, b: number): number {
  if (a === b) return 0; // cobre Infinity === Infinity
  return a < b ? -1 : 1;
}

/** (vitórias de x sobre y) - (vitórias de y sobre x). */
function headToHead(decided: readonly Decided[], x: Id, y: Id): number {
  let score = 0;
  for (const d of decided) {
    if (!((d.a === x && d.b === y) || (d.a === y && d.b === x))) continue;
    if (d.winner === x) score++;
    else if (d.winner === y) score--;
  }
  return score;
}
