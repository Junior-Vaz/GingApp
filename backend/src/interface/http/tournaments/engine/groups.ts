import { createRng, shuffle } from './rng';
import { roundRobinMatches } from './round-robin';
import { groupComparisonKey, orderBySeed } from './single-elimination';
import { EngineCompetitor, GenerateGroupsOptions, GroupsResult, Id, MatchSpec } from './types';

/**
 * Fase de grupos (contrato §3, item 3): distribuição "serpentina" por semente, tamanhos que diferem em no máximo 1,
 * cada grupo é um todos-contra-todos (`groupIndex` = índice do grupo).
 *
 * - BY_SEED: sementes informadas primeiro (serpentina), sem semente depois em ordem de sorteio.
 * - RANDOM: serpentina sobre a ordem sorteada.
 * - AVOID_SAME_GROUP: espalha atletas do mesmo `groupName` entre os grupos (melhor esforço, determinístico);
 *   as sementes informadas são ignoradas neste modo.
 */
export function generateGroups(competitors: EngineCompetitor[], opts: GenerateGroupsOptions): GroupsResult {
  const n = competitors.length;
  const groupCount = opts.groupCount;
  if (!Number.isInteger(groupCount) || groupCount < 1) throw new Error('groupCount inválido.');
  if (n < groupCount) throw new Error('Há mais grupos do que atletas.');
  const seen = new Set<Id>();
  for (const c of competitors) {
    if (seen.has(c.id)) throw new Error(`Atleta repetido: ${c.id}.`);
    seen.add(c.id);
  }

  const rng = createRng(opts.rngSeed);
  const groups: Id[][] = Array.from({ length: groupCount }, () => []);

  if (opts.seeding === 'AVOID_SAME_GROUP') {
    distributeAvoidingSameGroup(competitors, groups, rng);
  } else {
    const ordered = opts.seeding === 'BY_SEED' ? orderBySeed(competitors, rng) : shuffle(competitors, rng).map((c) => c.id);
    ordered.forEach((id, i) => {
      const row = Math.floor(i / groupCount);
      const col = i % groupCount;
      groups[row % 2 === 0 ? col : groupCount - 1 - col].push(id);
    });
  }

  const matches: MatchSpec[] = [];
  groups.forEach((ids, g) => matches.push(...roundRobinMatches(ids, g)));
  return { groups, matches };
}

/**
 * Academias contíguas na fila + distribuição circular (não serpentina): os membros consecutivos da mesma academia caem
 * em grupos consecutivos, então nenhum grupo recebe mais que ⌈tamanho da academia / grupos⌉ dela (ótimo) e os tamanhos
 * dos grupos diferem em no máximo 1. O sorteio embaralha a ordem das academias, dos atletas e o grupo inicial.
 */
function distributeAvoidingSameGroup(competitors: readonly EngineCompetitor[], groups: Id[][], rng: () => number): void {
  const groupCount = groups.length;
  const byAcademy = new Map<string, Id[]>();
  for (const c of competitors) {
    const key = groupComparisonKey(c);
    byAcademy.set(key, [...(byAcademy.get(key) ?? []), c.id]);
  }
  const queue = shuffle([...byAcademy.values()], rng).flatMap((ids) => shuffle(ids, rng));
  const offset = Math.floor(rng() * groupCount);
  queue.forEach((id, i) => groups[(i + offset) % groupCount].push(id));
}
