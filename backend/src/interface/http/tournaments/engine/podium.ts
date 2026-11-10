import { ComputePodiumInput, Id, PodiumEntry, PodiumMatch } from './types';

/** Posição 0-based no fim da key (`MAIN-2-1` -> 1); usada só para ordenar de forma estável. */
function positionOf(key: string): number {
  const n = Number(key.slice(key.lastIndexOf('-') + 1));
  return Number.isFinite(n) ? n : 0;
}

function isDecided(m: PodiumMatch | undefined): m is PodiumMatch & { winnerId: Id } {
  return !!m && m.status === 'FINISHED' && m.winnerId !== null && m.winnerId !== undefined;
}

/** O outro atleta da luta (o que não é o vencedor); null se a luta não tem os dois lados. */
function loserOf(m: PodiumMatch & { winnerId: Id }): Id | null {
  if (m.slotA === null || m.slotB === null) return null;
  if (m.winnerId === m.slotA) return m.slotB;
  if (m.winnerId === m.slotB) return m.slotA;
  return null;
}

/**
 * Pódio (contrato §3, item 7). Vazio enquanto não houver final decidida.
 * - SINGLE_ELIMINATION e mata-mata de GROUPS_KNOCKOUT: 1º = vencedor da final, 2º = o outro finalista;
 *   3º = vencedor da disputa de 3º quando `thirdPlace` e decidida. Sem disputa de 3º (flag desligada, ou N < 4 em que
 *   a disputa nem existe) os perdedores das semifinais decididas saem como 3º (dois itens `place: 3`;
 *   com N = 3 só há uma semifinal real, então um item).
 * - ROUND_ROBIN: top 3 do ranking só quando TODAS as lutas terminaram.
 */
export function computePodium(input: ComputePodiumInput): PodiumEntry[] {
  if (input.format === 'ROUND_ROBIN') return roundRobinPodium(input);

  const main = input.matches.filter((m) => m.stage === 'MAIN');
  if (main.length === 0) return [];
  const finalRound = Math.max(...main.map((m) => m.round));
  const final = main.find((m) => m.round === finalRound);
  if (!isDecided(final)) return [];

  const podium: PodiumEntry[] = [{ place: 1, competitorId: final.winnerId }];
  const runnerUp = loserOf(final);
  if (runnerUp !== null) podium.push({ place: 2, competitorId: runnerUp });

  const thirdMatch = input.matches.find((m) => m.stage === 'THIRD_PLACE');
  if (input.thirdPlace && thirdMatch) {
    if (isDecided(thirdMatch)) podium.push({ place: 3, competitorId: thirdMatch.winnerId });
    return podium;
  }

  const semis = main
    .filter((m) => m.round === finalRound - 1 && !m.isBye)
    .sort((a, b) => positionOf(a.key) - positionOf(b.key));
  for (const semi of semis) {
    if (!isDecided(semi)) continue;
    const loser = loserOf(semi);
    if (loser !== null) podium.push({ place: 3, competitorId: loser });
  }
  return podium;
}

function roundRobinPodium(input: ComputePodiumInput): PodiumEntry[] {
  const games = input.matches.filter((m) => m.stage === 'GROUP' || m.stage === 'MAIN');
  if (games.length === 0) return [];
  if (!games.every((m) => m.status === 'FINISHED')) return [];
  const top = [...input.standings].sort((a, b) => a.rank - b.rank).slice(0, 3);
  return top.map((row, i) => ({ place: (i + 1) as 1 | 2 | 3, competitorId: row.competitorId }));
}
