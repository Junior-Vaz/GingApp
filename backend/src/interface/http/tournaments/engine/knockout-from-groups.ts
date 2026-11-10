import { generateSingleElimination, round1RealPairRanks } from './single-elimination';
import { BuildKnockoutFromGroupsOptions, EngineCompetitor, Id, MatchSpec } from './types';

interface Qualified {
  id: Id;
  /** índice do grupo de origem */
  g: number;
}

/** Limite de variações testadas na busca de um cruzamento sem confronto do mesmo grupo na 1ª rodada. */
const MAX_LAYOUT_TRIES = 20000;

/**
 * Mata-mata a partir dos grupos (contrato §3, item 5).
 * Classificados = `advancePerGroup` primeiros de cada grupo. Semente de cada um = (colocação no grupo, índice do grupo):
 * 1ºA, 1ºB, ... depois 2ºA, 2ºB ... — os 1ºs ficam em lados opostos. Reusa `generateSingleElimination` (BY_SEED, prefixo MAIN).
 *
 * Refinamento determinístico: se essa ordem padrão põe dois do MESMO grupo frente a frente na 1ª rodada
 * (ex.: 3 grupos, 2 por grupo: 1ºC × 2ºC), a ordem das colocações 2ª em diante é girada/invertida até não haver
 * confronto do mesmo grupo na rodada 1 (se possível). Quando a ordem padrão já está limpa, ela é mantida.
 */
export function buildKnockoutFromGroups(orderedGroups: Id[][], opts: BuildKnockoutFromGroupsOptions): MatchSpec[] {
  const advance = opts.advancePerGroup;
  if (!Number.isInteger(advance) || advance < 1) throw new Error('advancePerGroup inválido.');

  const tiers: Qualified[][] = Array.from({ length: advance }, () => []);
  orderedGroups.forEach((ids, g) => {
    for (let place = 0; place < Math.min(advance, ids.length); place++) tiers[place].push({ id: ids[place], g });
  });
  const total = tiers.reduce((acc, t) => acc + t.length, 0);
  if (total < 2) throw new Error('Mata-mata exige ao menos 2 classificados.');

  const ordered = chooseSeedOrder(tiers, total);
  const seen = new Set<Id>();
  const competitors: EngineCompetitor[] = ordered.map((q, i) => {
    if (seen.has(q.id)) throw new Error(`Atleta repetido nos grupos: ${q.id}.`);
    seen.add(q.id);
    return { id: q.id, seed: i + 1, groupName: `Grupo ${q.g}` };
  });

  return generateSingleElimination(competitors, {
    seeding: 'BY_SEED',
    thirdPlace: opts.thirdPlace,
    rngSeed: opts.rngSeed,
    keyPrefix: 'MAIN',
  });
}

/** Confrontos do mesmo grupo na rodada 1 para uma ordem de sementes. */
function sameGroupRound1(order: readonly Qualified[], pairs: ReadonlyArray<[number, number]>): number {
  let bad = 0;
  for (const [a, b] of pairs) if (order[a - 1].g === order[b - 1].g) bad++;
  return bad;
}

function chooseSeedOrder(tiers: Qualified[][], total: number): Qualified[] {
  const pairs = round1RealPairRanks(total);
  const build = (variant: number[]): Qualified[] => {
    const out: Qualified[] = [];
    tiers.forEach((tier, t) => {
      if (t === 0 || tier.length === 0) {
        out.push(...tier);
        return;
      }
      const L = tier.length;
      const v = variant[t];
      const rotation = v % L;
      const reversed = Math.floor(v / L) === 1;
      const rotated = tier.map((_, i) => tier[(i + rotation) % L]);
      out.push(...(reversed ? rotated.reverse() : rotated));
    });
    return out;
  };

  // Odômetro sobre (rotação, inversão) de cada colocação >= 2ª; a variante 0 é a ordem padrão.
  const variant = tiers.map(() => 0);
  const limits = tiers.map((t) => Math.max(1, t.length * 2));
  let best = build(variant);
  let bestBad = sameGroupRound1(best, pairs);
  for (let tries = 0; bestBad > 0 && tries < MAX_LAYOUT_TRIES; tries++) {
    let t = tiers.length - 1;
    while (t >= 1) {
      variant[t]++;
      if (variant[t] < limits[t]) break;
      variant[t] = 0;
      t--;
    }
    if (t < 1) break; // percorreu todas as variantes
    const candidate = build(variant);
    const bad = sameGroupRound1(candidate, pairs);
    if (bad < bestBad) {
      best = candidate;
      bestBad = bad;
    }
  }
  return best;
}
