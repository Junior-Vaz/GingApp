import { createRng, shuffle } from './rng';
import { EngineCompetitor, GenerateSingleEliminationOptions, Id, MatchSpec, Slot } from './types';

/** Prefixo fixo da disputa de 3º lugar (a `keyPrefix` das opções vale só para a chave principal). */
const THIRD_PLACE_PREFIX = 'THIRD_PLACE';

/** Menor potência de 2 maior ou igual a n (n >= 1). */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Posicionamento padrão de sementes numa chave de tamanho `size` (potência de 2):
 * `result[i]` = semente (1-based) que ocupa a posição `i`; as lutas da rodada 1 são os pares (2k, 2k+1).
 * Ex.: size 8 -> [1,8,4,5,2,7,3,6] (1×8, 4×5, 2×7, 3×6): as melhores sementes só se cruzam o mais tarde possível.
 */
export function seedPositions(size: number): number[] {
  let pos = [1];
  while (pos.length < size) {
    const n = pos.length * 2;
    const next: number[] = [];
    for (const s of pos) next.push(s, n + 1 - s);
    pos = next;
  }
  return pos;
}

/**
 * Pares de lutas REAIS da rodada 1 (sem folga), em ranks de semente 1-based [rankA, rankB],
 * para `n` atletas numa chave de tamanho `nextPowerOfTwo(n)`.
 */
export function round1RealPairRanks(n: number): Array<[number, number]> {
  const size = nextPowerOfTwo(n);
  const pos = seedPositions(size);
  const out: Array<[number, number]> = [];
  for (let k = 0; k < size / 2; k++) {
    const a = pos[2 * k];
    const b = pos[2 * k + 1];
    if (a <= n && b <= n) out.push([a, b]);
  }
  return out;
}

function assertCompetitors(competitors: readonly EngineCompetitor[]): void {
  if (competitors.length < 2) throw new Error('Chave exige ao menos 2 atletas.');
  const seen = new Set<Id>();
  for (const c of competitors) {
    if (seen.has(c.id)) throw new Error(`Atleta repetido na chave: ${c.id}.`);
    seen.add(c.id);
  }
}

/** Ordem por semente: sementes informadas primeiro (empate por sorteio), sem semente ao fim em ordem de sorteio. */
export function orderBySeed(competitors: readonly EngineCompetitor[], rng: () => number): Id[] {
  const shuffled = shuffle(competitors, rng);
  const hasSeed = (c: EngineCompetitor) => c.seed !== null && c.seed !== undefined && Number.isFinite(c.seed);
  const seeded = shuffled.filter(hasSeed).sort((a, b) => (a.seed as number) - (b.seed as number)); // sort estável
  const rest = shuffled.filter((c) => !hasSeed(c));
  return [...seeded, ...rest].map((c) => c.id);
}

interface GroupedCompetitor {
  id: Id;
  /** Chave de comparação do grupo; atleta sem grupo vira um grupo só dele (nunca conflita). */
  g: string;
}

/** Chave de comparação de grupo: ignora caixa e espaços nas pontas; sem grupo = único por atleta. */
export function groupComparisonKey(c: EngineCompetitor): string {
  const t = (c.groupName ?? '').trim().toLowerCase();
  return t === '' ? `\u0000solo:${c.id}` : t;
}

/** Quantos pares cruzados (grupos diferentes) cabem no máximo entre `total` atletas com a maior contagem `maxCount`. */
function crossPairCapacity(total: number, maxCount: number): number {
  return Math.min(Math.floor(total / 2), total - maxCount);
}

function maxCountOf(counts: Map<string, number>, minus1?: string, minus2?: string): number {
  let max = 0;
  for (const [k, v] of counts) {
    const c = v - (k === minus1 ? 1 : 0) - (k === minus2 ? 1 : 0);
    if (c > max) max = c;
  }
  return max;
}

/**
 * AVOID_SAME_GROUP: sorteio determinístico cujas lutas REAIS da rodada 1 (sem folga) são entre grupos diferentes.
 * Escolhe K pares cruzados (K = lutas reais) mantendo viável o restante; quem sobra ganha folga.
 * As sementes informadas são ignoradas neste modo. Sem solução possível (um grupo domina), sobra o melhor esforço.
 * Devolve os ids em ordem de rank (índice 0 = rank 1).
 */
function orderAvoidingSameGroup(competitors: readonly EngineCompetitor[], size: number, rng: () => number): Id[] {
  const n = competitors.length;
  const byeCount = size - n;
  const realMatches = n - size / 2;

  const pool: GroupedCompetitor[] = shuffle(competitors, rng).map((c) => ({ id: c.id, g: groupComparisonKey(c) }));
  const counts = new Map<string, number>();
  for (const p of pool) counts.set(p.g, (counts.get(p.g) ?? 0) + 1);

  const wanted = Math.min(realMatches, crossPairCapacity(n, maxCountOf(counts)));
  const remaining = pool.slice();
  const pairs: Array<[Id, Id]> = [];

  for (let i = 0; i < wanted; i++) {
    const target = wanted - i - 1;
    let pickA = -1;
    let pickB = -1;
    search: for (let a = 0; a < remaining.length; a++) {
      for (let b = a + 1; b < remaining.length; b++) {
        if (remaining[a].g === remaining[b].g) continue;
        const left = remaining.length - 2;
        if (crossPairCapacity(left, maxCountOf(counts, remaining[a].g, remaining[b].g)) >= target) {
          pickA = a;
          pickB = b;
          break search;
        }
      }
    }
    if (pickA < 0) break; // não deveria ocorrer (a escolha gulosa dos dois maiores sempre serve), mas nunca trava
    const A = remaining[pickA];
    const B = remaining[pickB];
    remaining.splice(pickB, 1);
    remaining.splice(pickA, 1);
    counts.set(A.g, (counts.get(A.g) ?? 1) - 1);
    counts.set(B.g, (counts.get(B.g) ?? 1) - 1);
    pairs.push(rng() < 0.5 ? [A.id, B.id] : [B.id, A.id]);
  }

  // Melhor esforço: lutas reais que sobraram (um grupo grande demais) saem do que restou.
  while (pairs.length < realMatches && remaining.length >= 2) {
    const A = remaining.shift() as GroupedCompetitor;
    const B = remaining.shift() as GroupedCompetitor;
    pairs.push([A.id, B.id]);
  }

  const byes = remaining.map((r) => r.id); // sobraram exatamente `byeCount`
  // Ranks 1..byeCount = folgas; pares ocupam o rank s e o rank size+1-s (s = byeCount+1 .. size/2), cobrindo até o rank n.
  const order: Id[] = new Array(size).fill(0);
  for (let i = 0; i < byeCount; i++) order[i] = byes[i];
  pairs.forEach(([a, b], j) => {
    const rank = byeCount + 1 + j;
    order[rank - 1] = a;
    order[size - rank] = b;
  });
  return order.slice(0, n);
}

function toKey(prefix: string, round: number, position: number): string {
  return `${prefix}-${round}-${position}`;
}

/**
 * Chave de eliminatória simples (contrato §3, item 1). PURA e determinística por `rngSeed`.
 * Devolve as lutas por rodada/posição; a disputa de 3º (se houver) vem por último.
 */
export function generateSingleElimination(
  competitors: EngineCompetitor[],
  opts: GenerateSingleEliminationOptions,
): MatchSpec[] {
  assertCompetitors(competitors);
  const n = competitors.length;
  const size = nextPowerOfTwo(n);
  const rng = createRng(opts.rngSeed);

  let ranked: Id[]; // ranked[r-1] = atleta de rank (semente efetiva) r
  if (opts.seeding === 'BY_SEED') {
    ranked = orderBySeed(competitors, rng);
  } else if (opts.seeding === 'AVOID_SAME_GROUP') {
    ranked = orderAvoidingSameGroup(competitors, size, rng);
  } else {
    ranked = shuffle(competitors, rng).map((c) => c.id);
  }
  return buildBracket(ranked, opts.thirdPlace, opts.keyPrefix ?? 'MAIN');
}

/** Monta a árvore a partir dos atletas já em ordem de rank (índice 0 = rank 1). */
function buildBracket(ranked: Id[], thirdPlace: boolean, prefix: string): MatchSpec[] {
  const n = ranked.length;
  const size = nextPowerOfTwo(n);
  let rounds = 0;
  for (let s = size; s > 1; s /= 2) rounds++;

  const pos = seedPositions(size);
  const byRound: MatchSpec[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const list: MatchSpec[] = [];
    for (let p = 0; p < count; p++) {
      list.push({
        key: toKey(prefix, r, p),
        stage: 'MAIN',
        round: r,
        position: p,
        groupIndex: null,
        slotA: null,
        slotB: null,
        isBye: false,
        winnerId: null,
        next: r < rounds ? { key: toKey(prefix, r + 1, p >> 1), slot: (p % 2 === 0 ? 'A' : 'B') as Slot } : null,
        loserNext: null,
      });
    }
    byRound.push(list);
  }

  // Rodada 1: rank > n = vaga vazia (folga). Folga só aparece para as melhores sementes (ranks 1..size-n).
  const first = byRound[0];
  for (let k = 0; k < first.length; k++) {
    const rankA = pos[2 * k];
    const rankB = pos[2 * k + 1];
    const m = first[k];
    m.slotA = rankA <= n ? ranked[rankA - 1] : null;
    m.slotB = rankB <= n ? ranked[rankB - 1] : null;
    if ((m.slotA === null) !== (m.slotB === null)) {
      m.isBye = true;
      m.winnerId = m.slotA !== null ? m.slotA : m.slotB;
      const target = byRound[1]?.[m.position >> 1];
      if (target && m.next) {
        if (m.next.slot === 'A') target.slotA = m.winnerId;
        else target.slotB = m.winnerId;
      }
    }
  }

  const specs = byRound.flat();

  if (thirdPlace && n >= 4 && rounds >= 2) {
    const thirdKey = toKey(THIRD_PLACE_PREFIX, rounds, 0);
    const semis = byRound[rounds - 2];
    semis[0].loserNext = { key: thirdKey, slot: 'A' };
    semis[1].loserNext = { key: thirdKey, slot: 'B' };
    specs.push({
      key: thirdKey,
      stage: 'THIRD_PLACE',
      round: rounds,
      position: 0,
      groupIndex: null,
      slotA: null,
      slotB: null,
      isBye: false,
      winnerId: null,
      next: null,
      loserNext: null,
    });
  }
  return specs;
}
