import { createRng, shuffle } from './rng';
import { EngineCompetitor, GenerateRoundRobinOptions, Id, MatchSpec } from './types';

/**
 * Todos-contra-todos de um grupo pelo método do círculo, na ORDEM dada dos ids.
 * N ímpar usa uma folga fantasma: o atleta que a enfrentaria descansa na rodada (não vira luta).
 * Rodadas 1-based; `position` 0-based dentro da rodada (só conta lutas reais); keys `GROUP-<g>-<round>-<position>`.
 */
export function roundRobinMatches(ids: readonly Id[], groupIndex: number): MatchSpec[] {
  const players: Array<Id | null> = ids.slice();
  if (players.length % 2 === 1) players.push(null); // folga fantasma
  const m = players.length;
  const out: MatchSpec[] = [];
  if (m < 2) return out;

  let arr = players.slice();
  for (let round = 1; round <= m - 1; round++) {
    let position = 0;
    for (let i = 0; i < m / 2; i++) {
      let a = arr[i];
      let b = arr[m - 1 - i];
      if (a === null || b === null) continue;
      // Alterna o lado do atleta fixo para não deixá-lo sempre no slot A.
      if (i === 0 && round % 2 === 0) [a, b] = [b, a];
      out.push({
        key: `GROUP-${groupIndex}-${round}-${position}`,
        stage: 'GROUP',
        round,
        position,
        groupIndex,
        slotA: a,
        slotB: b,
        isBye: false,
        winnerId: null,
        next: null,
        loserNext: null,
      });
      position++;
    }
    arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
  }
  return out;
}

/** Todos contra todos (contrato §3, item 2): N(N-1)/2 lutas, cada atleta no máximo 1 luta por rodada. */
export function generateRoundRobin(competitors: EngineCompetitor[], opts: GenerateRoundRobinOptions): MatchSpec[] {
  if (competitors.length < 2) throw new Error('Todos-contra-todos exige ao menos 2 atletas.');
  const seen = new Set<Id>();
  for (const c of competitors) {
    if (seen.has(c.id)) throw new Error(`Atleta repetido: ${c.id}.`);
    seen.add(c.id);
  }
  const rng = createRng(opts.rngSeed);
  const ids = shuffle(competitors, rng).map((c) => c.id);
  return roundRobinMatches(ids, 0);
}
