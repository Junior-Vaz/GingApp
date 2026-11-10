import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildKnockoutFromGroups,
  computePodium,
  computeStandings,
  createRng,
  generateGroups,
  generateRoundRobin,
  generateSingleElimination,
  resolveAdvancement,
} from '../src/interface/http/tournaments/engine';
import type {
  EngineCompetitor,
  Id,
  MatchResult,
  MatchSpec,
  PodiumMatch,
  Seeding,
} from '../src/interface/http/tournaments/engine';

/**
 * Motor de chaveamento (docs/CONTRATO_CHAVEAMENTO.md §3 e §8): testes PUROS, sem banco.
 * Convenção: "lutas reais" = lutas sem folga (isBye=false). O motor também devolve as lutas de folga (isBye=true),
 * então o total de MatchSpec da eliminatória é P-1 (P = potência de 2 >= N), e as lutas reais são N-1 (+1 com 3º lugar).
 */

const RNG_SEEDS = [1, 7, 42, 2026, 987654321];
const SEEDINGS: Seeding[] = ['RANDOM', 'BY_SEED', 'AVOID_SAME_GROUP'];
/** N = 2..64 e 100, 128 (contrato §8). */
const SIZES = [...Array.from({ length: 63 }, (_, i) => i + 2), 100, 128];

const pow2 = (n: number) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

function competitors(n: number, opts: { seeded?: boolean; groupOf?: (i: number) => string | null; base?: number } = {}): EngineCompetitor[] {
  const base = opts.base ?? 1000;
  return Array.from({ length: n }, (_, i) => ({
    id: base + i,
    seed: opts.seeded ? i + 1 : null,
    groupName: opts.groupOf ? opts.groupOf(i) : null,
  }));
}

const norm = (g: string | null) => (g ?? '').trim().toLowerCase();

/** Valida TODAS as propriedades estruturais de uma chave de eliminatória simples (contrato §3). */
function assertBracket(specs: MatchSpec[], comps: EngineCompetitor[], thirdPlace: boolean, label: string): void {
  const n = comps.length;
  const size = pow2(n);
  const rounds = Math.log2(size);
  const main = specs.filter((m) => m.stage === 'MAIN');
  const third = specs.filter((m) => m.stage === 'THIRD_PLACE');
  const withThird = thirdPlace && n >= 4;
  const byKey = new Map(specs.map((m) => [m.key, m]));

  assert.equal(byKey.size, specs.length, `${label}: keys únicas`);
  assert.equal(specs.filter((m) => !m.isBye).length, n - 1 + (withThird ? 1 : 0), `${label}: lutas reais = N-1 (+1 com 3º)`);
  assert.equal(main.length, size - 1, `${label}: lutas MAIN (com folgas) = P-1`);
  assert.equal(third.length, withThird ? 1 : 0, `${label}: disputa de 3º só com N>=4`);
  for (let r = 1; r <= rounds; r++) {
    assert.equal(main.filter((m) => m.round === r).length, size / 2 ** r, `${label}: nº de lutas na rodada ${r}`);
  }
  for (const m of main) {
    assert.equal(m.key, `MAIN-${m.round}-${m.position}`, `${label}: formato da key`);
    assert.equal(m.groupIndex, null);
  }

  // Rodada 1: cada atleta exatamente uma vez (em luta ou folga).
  const first = main.filter((m) => m.round === 1);
  const seen: Id[] = [];
  for (const m of first) {
    if (m.slotA !== null) seen.push(m.slotA);
    if (m.slotB !== null) seen.push(m.slotB);
  }
  assert.equal(seen.length, n, `${label}: ${n} atletas na rodada 1`);
  assert.deepEqual([...seen].sort((a, b) => a - b), comps.map((c) => c.id).sort((a, b) => a - b), `${label}: todo atleta 1x na rodada 1`);

  // Nenhuma luta com o mesmo atleta nos dois lados; ninguém aparece 2x em lutas da mesma rodada.
  for (const m of specs) {
    if (m.slotA !== null) assert.notEqual(m.slotA, m.slotB, `${label}: ${m.key} com o mesmo atleta nos dois lados`);
  }

  // Folgas: só na rodada 1, exatamente P-N, nunca bye x bye, vencedor = atleta presente.
  const byes = specs.filter((m) => m.isBye);
  assert.equal(byes.length, size - n, `${label}: P-N folgas`);
  for (const m of specs) {
    if (m.isBye) {
      assert.equal(m.round, 1, `${label}: folga só na rodada 1`);
      assert.equal(m.stage, 'MAIN');
      assert.ok((m.slotA === null) !== (m.slotB === null), `${label}: ${m.key} folga com exatamente 1 atleta`);
      assert.equal(m.winnerId, m.slotA ?? m.slotB, `${label}: ${m.key} vencedor da folga é o presente`);
    } else {
      assert.equal(m.winnerId, null, `${label}: ${m.key} sem vencedor antes de lutar`);
    }
  }
  for (const m of first) {
    assert.ok(m.slotA !== null || m.slotB !== null, `${label}: ${m.key} bye x bye`);
  }

  // `next`: toda luta, exceto a final e o 3º lugar, aponta para um slot que existe, livre e único.
  const final = main.find((m) => m.round === rounds && m.position === 0)!;
  assert.ok(final, `${label}: final existe`);
  assert.equal(final.next, null);
  const targets = new Set<string>();
  const incoming = new Map<string, number>();
  for (const m of main) {
    if (m === final) continue;
    assert.ok(m.next, `${label}: ${m.key} sem next`);
    const target = byKey.get(m.next.key);
    assert.ok(target, `${label}: ${m.key}.next aponta para key inexistente ${m.next.key}`);
    assert.equal(target.stage, 'MAIN');
    assert.equal(target.round, m.round + 1, `${label}: next vai para a rodada seguinte`);
    const slotId = `${m.next.key}#${m.next.slot}`;
    assert.ok(!targets.has(slotId), `${label}: dois apontando para o mesmo slot ${slotId}`);
    targets.add(slotId);
    incoming.set(target.key, (incoming.get(target.key) ?? 0) + 1);
    const occupant = m.next.slot === 'A' ? target.slotA : target.slotB;
    if (m.isBye) {
      assert.equal(occupant, m.winnerId, `${label}: vencedor da folga já está no slot da próxima luta`);
      // O que o serviço faria com resolveAdvancement coincide com o que o motor já colocou.
      assert.deepEqual(resolveAdvancement(m, { winnerId: m.winnerId as Id, loserId: null }), [
        { matchKey: m.next.key, slot: m.next.slot, competitorId: m.winnerId as Id },
      ]);
    } else {
      assert.equal(occupant, null, `${label}: slot ${slotId} deveria estar livre`);
    }
  }
  for (const m of main.filter((x) => x.round > 1)) {
    assert.equal(incoming.get(m.key), 2, `${label}: ${m.key} recebe exatamente 2 alimentadores`);
  }
  // Árvore única convergindo na final.
  assert.equal(main.filter((m) => m.next === null).length, 1);
  for (const m of main) {
    let cur = m;
    let guard = 0;
    while (cur.next) {
      cur = byKey.get(cur.next.key) as MatchSpec;
      assert.ok(++guard <= rounds, `${label}: ciclo`);
    }
    assert.equal(cur.key, final.key, `${label}: ${m.key} não converge na final`);
  }
  // Rodadas > 1 só têm slots pré-preenchidos por folgas.
  for (const m of main.filter((x) => x.round > 1)) {
    for (const slot of ['A', 'B'] as const) {
      const val = slot === 'A' ? m.slotA : m.slotB;
      if (val !== null) {
        const feeder = main.find((f) => f.next?.key === m.key && f.next.slot === slot) as MatchSpec;
        assert.ok(feeder.isBye && feeder.winnerId === val, `${label}: ${m.key} slot ${slot} preenchido sem folga`);
      }
    }
  }

  // 3º lugar.
  if (withThird) {
    const t = third[0];
    assert.equal(t.key, `THIRD_PLACE-${rounds}-0`);
    assert.equal(t.round, rounds);
    assert.equal(t.position, 0);
    assert.equal(t.next, null);
    assert.equal(t.loserNext, null);
    assert.equal(t.slotA, null);
    assert.equal(t.slotB, null);
    const semis = main.filter((m) => m.round === rounds - 1).sort((a, b) => a.position - b.position);
    assert.equal(semis.length, 2);
    assert.deepEqual(semis[0].loserNext, { key: t.key, slot: 'A' });
    assert.deepEqual(semis[1].loserNext, { key: t.key, slot: 'B' });
    assert.ok(semis.every((s) => !s.isBye), `${label}: semifinal não é folga quando há 3º`);
    for (const m of main.filter((x) => x.round !== rounds - 1)) assert.equal(m.loserNext, null);
  } else {
    for (const m of specs) assert.equal(m.loserNext, null, `${label}: sem 3º não há loserNext`);
  }
}

/** Posição (0-based) da luta da rodada 1 onde o atleta está. */
function round1PositionOf(specs: MatchSpec[], id: Id): number {
  const m = specs.find((x) => x.stage === 'MAIN' && x.round === 1 && (x.slotA === id || x.slotB === id));
  assert.ok(m, `atleta ${id} não está na rodada 1`);
  return m.position;
}

/** Layouts de grupos para a rodada 1 (AVOID_SAME_GROUP). Cada um devolve o nome do grupo do atleta i. */
const GROUP_LAYOUTS: Array<{ name: string; groupOf: (i: number, n: number) => string | null }> = [
  { name: 'ninguém tem grupo', groupOf: () => null },
  { name: 'todos de grupos distintos', groupOf: (i) => `G${i}` },
  { name: '2 grupos alternados', groupOf: (i) => (i % 2 === 0 ? 'A' : 'B') },
  { name: '2 grupos em bloco (A = ⌈N/2⌉)', groupOf: (i, n) => (i < Math.ceil(n / 2) ? 'A' : 'B') },
  { name: '3 grupos', groupOf: (i) => `G${i % 3}` },
  { name: 'grupos de 4', groupOf: (i) => `G${Math.floor(i / 4)}` },
  { name: 'grande ⌈N/2⌉ + resto distinto', groupOf: (i, n) => (i < Math.ceil(n / 2) ? 'Grande' : `solo${i}`) },
  { name: 'metade + quarto + resto', groupOf: (i, n) => (i < Math.ceil(n / 2) ? 'A' : i < Math.ceil(n / 2) + Math.floor(n / 4) ? 'B' : `c${i}`) },
  { name: 'grupos com caixa/espaços diferentes (normalizados)', groupOf: (i) => [' Alfa ', 'alfa', 'Beta', 'BETA '][i % 4] },
];

function isViable(groups: Array<string | null>): boolean {
  const n = groups.length;
  const counts = new Map<string, number>();
  groups.forEach((g, i) => {
    const k = norm(g) === '' ? `solo-${i}` : norm(g);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  return Math.max(...counts.values()) <= Math.ceil(n / 2);
}

// ---------------------------------------------------------------------------------------------------------------------
describe('rng determinístico', () => {
  it('mesma semente => mesma sequência, valores em [0,1), sementes diferentes divergem', () => {
    const a = createRng(123);
    const b = createRng(123);
    const c = createRng(124);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    const seqC = Array.from({ length: 50 }, () => c());
    assert.deepEqual(seqA, seqB);
    assert.notDeepEqual(seqA, seqC);
    for (const v of seqA) assert.ok(v >= 0 && v < 1);
    assert.ok(new Set(seqA).size > 45, 'sequência sem repetição óbvia');
  });
  it('semente 0, negativa, fracionária e enorme não quebram', () => {
    for (const s of [0, -5, 3.7, 2 ** 40, Number.MAX_SAFE_INTEGER, NaN]) {
      const r = createRng(s);
      const v = r();
      assert.ok(v >= 0 && v < 1, `semente ${s}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('eliminatória simples: exemplos fixos (golden)', () => {
  const view = (specs: MatchSpec[]) =>
    specs.map((m) => [m.key, m.slotA, m.slotB, m.isBye, m.winnerId, m.next ? `${m.next.key}:${m.next.slot}` : null, m.loserNext ? `${m.loserNext.key}:${m.loserNext.slot}` : null]);
  const gen = (n: number, thirdPlace = false) =>
    generateSingleElimination(competitors(n, { seeded: true, base: 1 }), { seeding: 'BY_SEED', thirdPlace, rngSeed: 99 });

  it('N=5 com sementes 1..5 (P=8, 3 folgas para as sementes 1, 2 e 3)', () => {
    assert.deepEqual(view(gen(5)), [
      ['MAIN-1-0', 1, null, true, 1, 'MAIN-2-0:A', null],
      ['MAIN-1-1', 4, 5, false, null, 'MAIN-2-0:B', null],
      ['MAIN-1-2', 2, null, true, 2, 'MAIN-2-1:A', null],
      ['MAIN-1-3', 3, null, true, 3, 'MAIN-2-1:B', null],
      ['MAIN-2-0', 1, null, false, null, 'MAIN-3-0:A', null],
      ['MAIN-2-1', 2, 3, false, null, 'MAIN-3-0:B', null],
      ['MAIN-3-0', null, null, false, null, null, null],
    ]);
  });

  it('N=6 com sementes 1..6 (P=8, 2 folgas para as sementes 1 e 2)', () => {
    assert.deepEqual(view(gen(6)), [
      ['MAIN-1-0', 1, null, true, 1, 'MAIN-2-0:A', null],
      ['MAIN-1-1', 4, 5, false, null, 'MAIN-2-0:B', null],
      ['MAIN-1-2', 2, null, true, 2, 'MAIN-2-1:A', null],
      ['MAIN-1-3', 3, 6, false, null, 'MAIN-2-1:B', null],
      ['MAIN-2-0', 1, null, false, null, 'MAIN-3-0:A', null],
      ['MAIN-2-1', 2, null, false, null, 'MAIN-3-0:B', null],
      ['MAIN-3-0', null, null, false, null, null, null],
    ]);
  });

  it('N=8 com sementes 1..8 e disputa de 3º (1×8, 4×5, 2×7, 3×6)', () => {
    assert.deepEqual(view(gen(8, true)), [
      ['MAIN-1-0', 1, 8, false, null, 'MAIN-2-0:A', null],
      ['MAIN-1-1', 4, 5, false, null, 'MAIN-2-0:B', null],
      ['MAIN-1-2', 2, 7, false, null, 'MAIN-2-1:A', null],
      ['MAIN-1-3', 3, 6, false, null, 'MAIN-2-1:B', null],
      ['MAIN-2-0', null, null, false, null, 'MAIN-3-0:A', 'THIRD_PLACE-3-0:A'],
      ['MAIN-2-1', null, null, false, null, 'MAIN-3-0:B', 'THIRD_PLACE-3-0:B'],
      ['MAIN-3-0', null, null, false, null, null, null],
      ['THIRD_PLACE-3-0', null, null, false, null, null, null],
    ]);
  });

  it('N=2: a final é a única luta; N=3: semifinal com folga; 3º lugar só com N>=4', () => {
    const two = gen(2, true);
    assert.equal(two.length, 1);
    assert.deepEqual(view(two), [['MAIN-1-0', 1, 2, false, null, null, null]]);

    const three = gen(3, true);
    assert.deepEqual(view(three), [
      ['MAIN-1-0', 1, null, true, 1, 'MAIN-2-0:A', null],
      ['MAIN-1-1', 2, 3, false, null, 'MAIN-2-0:B', null],
      ['MAIN-2-0', 1, null, false, null, null, null],
    ]);
    assert.equal(three.some((m) => m.stage === 'THIRD_PLACE'), false);
    assert.equal(gen(4, true).filter((m) => m.stage === 'THIRD_PLACE').length, 1);
  });

  it('keyPrefix muda só o prefixo da chave principal (o 3º lugar mantém THIRD_PLACE)', () => {
    const specs = generateSingleElimination(competitors(4, { seeded: true, base: 1 }), { seeding: 'BY_SEED', thirdPlace: true, rngSeed: 1, keyPrefix: 'KO' });
    assert.deepEqual(specs.map((m) => m.key), ['KO-1-0', 'KO-1-1', 'KO-2-0', 'THIRD_PLACE-2-0']);
    assert.deepEqual(specs[0].next, { key: 'KO-2-0', slot: 'A' });
  });

  it('BY_SEED: sementes fora de ordem na entrada; sem semente vão ao fim; empate de semente não quebra', () => {
    const comps: EngineCompetitor[] = [
      { id: 10, seed: null, groupName: null },
      { id: 20, seed: 2, groupName: null },
      { id: 30, seed: 1, groupName: null },
      { id: 40, seed: null, groupName: null },
    ];
    const specs = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 5 });
    assert.equal(specs[0].slotA, 30); // semente 1
    assert.equal(specs[1].slotA, 20); // semente 2 (luta 2×3)
    assert.ok([10, 40].includes(specs[0].slotB as number));
    assert.ok([10, 40].includes(specs[1].slotB as number));
    // semente repetida: não lança e mantém todos os atletas
    const dup = generateSingleElimination(
      [{ id: 1, seed: 1, groupName: null }, { id: 2, seed: 1, groupName: null }, { id: 3, seed: 2, groupName: null }],
      { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 5 },
    );
    assert.equal(dup.filter((m) => !m.isBye).length, 2);
  });

  it('entradas inválidas: menos de 2 atletas ou id repetido lançam erro', () => {
    assert.throws(() => generateSingleElimination([], { seeding: 'RANDOM', thirdPlace: false, rngSeed: 1 }));
    assert.throws(() => generateSingleElimination(competitors(1), { seeding: 'RANDOM', thirdPlace: false, rngSeed: 1 }));
    assert.throws(() => generateSingleElimination([{ id: 1, seed: null, groupName: null }, { id: 1, seed: null, groupName: null }], { seeding: 'RANDOM', thirdPlace: false, rngSeed: 1 }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('eliminatória simples: propriedades (N = 2..64, 100, 128 × 5 rngSeed × 3 sorteios)', () => {
  it('estrutura completa vale para todos os tamanhos, sorteios e com/sem 3º lugar', () => {
    let checked = 0;
    for (const n of SIZES) {
      for (const seeding of SEEDINGS) {
        for (const rngSeed of RNG_SEEDS) {
          for (const thirdPlace of [false, true]) {
            const comps = competitors(n, { seeded: seeding === 'BY_SEED', groupOf: (i) => `G${i % 5}` });
            const specs = generateSingleElimination(comps, { seeding, thirdPlace, rngSeed });
            assertBracket(specs, comps, thirdPlace, `N=${n} ${seeding} rngSeed=${rngSeed} 3º=${thirdPlace}`);
            checked++;
          }
        }
      }
    }
    assert.equal(checked, SIZES.length * 3 * 5 * 2);
  });

  it('BY_SEED com sementes 1..N: folgas vão para as sementes 1..P-N; cabeças de chave só se cruzam o mais tarde possível', () => {
    for (const n of SIZES) {
      const size = pow2(n);
      const comps = competitors(n, { seeded: true });
      for (const rngSeed of RNG_SEEDS) {
        const specs = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed });
        const byeIds = specs.filter((m) => m.isBye).map((m) => m.winnerId as Id).sort((a, b) => a - b);
        assert.deepEqual(byeIds, comps.slice(0, size - n).map((c) => c.id), `N=${n}: folgas para as melhores sementes`);
        // Semente s enfrenta P+1-s na rodada 1 (quando existe).
        for (const m of specs.filter((x) => x.round === 1 && !x.isBye)) {
          const sa = (m.slotA as number) - 1000 + 1;
          const sb = (m.slotB as number) - 1000 + 1;
          assert.equal(sa + sb, size + 1, `N=${n}: ${m.key} semente ${sa} × ${sb}`);
        }
        // Sementes 1 e 2 em metades opostas; 1..4 em quartos diferentes.
        const rounds = Math.log2(size);
        const p = (s: number) => round1PositionOf(specs, 1000 + s - 1);
        if (rounds >= 2 && n >= 2) assert.notEqual(p(1) >> (rounds - 2), p(2) >> (rounds - 2), `N=${n}: sementes 1 e 2 na mesma metade`);
        if (rounds >= 3 && n >= 4) {
          const quarters = new Set([1, 2, 3, 4].map((s) => p(s) >> (rounds - 3)));
          assert.equal(quarters.size, 4, `N=${n}: sementes 1..4 em quartos diferentes`);
        }
      }
    }
  });

  it('BY_SEED com sementes parciais: sementeados primeiro (folga para eles), sem semente depois em ordem de sorteio', () => {
    const n = 13; // P=16, 3 folgas
    const comps: EngineCompetitor[] = competitors(n).map((c, i) => ({ ...c, seed: i < 5 ? 5 - i : null })); // ids 1000..1004 = sementes 5,4,3,2,1
    for (const rngSeed of RNG_SEEDS) {
      const specs = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed });
      assertBracket(specs, comps, false, `parcial rngSeed=${rngSeed}`);
      const byeIds = specs.filter((m) => m.isBye).map((m) => m.winnerId as Id).sort((a, b) => a - b);
      assert.deepEqual(byeIds, [1002, 1003, 1004], 'folgas: sementes 1, 2 e 3');
      // semente 1 (id 1004) × rank 16 e semente 4 (id 1001) × rank 13 (ambos existem): 4×13
      const seed4 = specs.find((m) => m.round === 1 && (m.slotA === 1001 || m.slotB === 1001)) as MatchSpec;
      assert.ok(!seed4.isBye);
    }
    // Quem não tem semente muda de lugar conforme o rngSeed, mas a mesma rngSeed repete.
    const a = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 1 });
    const b = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 1 });
    const c = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 2 });
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  it('determinismo: mesma entrada + rngSeed => chave idêntica (deep equal); a entrada não é alterada', () => {
    for (const n of [2, 3, 5, 8, 13, 31, 64, 100]) {
      for (const seeding of SEEDINGS) {
        for (const rngSeed of RNG_SEEDS) {
          const comps = competitors(n, { seeded: seeding === 'BY_SEED', groupOf: (i) => `G${i % 4}` });
          const snapshot = JSON.parse(JSON.stringify(comps));
          const a = generateSingleElimination(comps, { seeding, thirdPlace: true, rngSeed });
          const b = generateSingleElimination(comps, { seeding, thirdPlace: true, rngSeed });
          assert.deepEqual(a, b, `N=${n} ${seeding} rngSeed=${rngSeed}`);
          assert.deepEqual(comps, snapshot, 'entrada intacta');
        }
      }
    }
  });

  it('RANDOM (e AVOID_SAME_GROUP) com N>=8: rngSeeds diferentes dão chaves diferentes', () => {
    for (const n of SIZES.filter((x) => x >= 8)) {
      for (const seeding of ['RANDOM', 'AVOID_SAME_GROUP'] as const) {
        const comps = competitors(n, { groupOf: (i) => `G${i % 7}` });
        const keys = new Set(RNG_SEEDS.map((rngSeed) => JSON.stringify(generateSingleElimination(comps, { seeding, thirdPlace: false, rngSeed }))));
        assert.equal(keys.size, RNG_SEEDS.length, `N=${n} ${seeding}: as ${RNG_SEEDS.length} rngSeeds deveriam dar chaves diferentes`);
      }
    }
  });

  it('BY_SEED totalmente semeado não depende do rngSeed', () => {
    const comps = competitors(20, { seeded: true });
    const a = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: true, rngSeed: 1 });
    const b = generateSingleElimination(comps, { seeding: 'BY_SEED', thirdPlace: true, rngSeed: 2 });
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('eliminatória simples: AVOID_SAME_GROUP', () => {
  it('com grupos viáveis (nenhum > ⌈N/2⌉) ninguém enfrenta o mesmo grupo na rodada 1 — vários layouts, N = 2..64, 100, 128, 5 rngSeeds', () => {
    let casesRun = 0;
    let skipped = 0;
    for (const layout of GROUP_LAYOUTS) {
      for (const n of SIZES) {
        const groups = Array.from({ length: n }, (_, i) => layout.groupOf(i, n));
        if (!isViable(groups)) {
          skipped++;
          continue;
        }
        const comps = competitors(n, { groupOf: (i) => groups[i] });
        const gOf = new Map(comps.map((c) => [c.id, norm(c.groupName)]));
        for (const rngSeed of RNG_SEEDS) {
          for (const thirdPlace of [false, true]) {
            const specs = generateSingleElimination(comps, { seeding: 'AVOID_SAME_GROUP', thirdPlace, rngSeed });
            const label = `${layout.name} N=${n} rngSeed=${rngSeed}`;
            assertBracket(specs, comps, thirdPlace, label);
            for (const m of specs.filter((x) => x.stage === 'MAIN' && x.round === 1 && x.slotA !== null && x.slotB !== null)) {
              const ga = gOf.get(m.slotA as number) as string;
              const gb = gOf.get(m.slotB as number) as string;
              assert.ok(ga === '' || ga !== gb, `${label}: ${m.key} põe o grupo "${ga}" contra ele mesmo`);
            }
            casesRun++;
          }
        }
      }
    }
    assert.ok(casesRun > 1500, `casos executados: ${casesRun}`);
    assert.ok(skipped < GROUP_LAYOUTS.length * SIZES.length, 'nem tudo foi pulado');
  });

  it('grupos inviáveis (um grupo domina): não trava, devolve chave válida (melhor esforço) e é determinístico', () => {
    for (const n of [4, 5, 8, 9, 17, 33, 64]) {
      const comps = competitors(n, { groupOf: (i) => (i < n - 1 ? 'Dominante' : 'Outro') });
      for (const rngSeed of RNG_SEEDS) {
        const a = generateSingleElimination(comps, { seeding: 'AVOID_SAME_GROUP', thirdPlace: true, rngSeed });
        assertBracket(a, comps, true, `inviável N=${n}`);
        assert.deepEqual(a, generateSingleElimination(comps, { seeding: 'AVOID_SAME_GROUP', thirdPlace: true, rngSeed }));
      }
    }
  });

  it('todos do mesmo grupo: não trava', () => {
    const comps = competitors(16, { groupOf: () => 'Unico' });
    const specs = generateSingleElimination(comps, { seeding: 'AVOID_SAME_GROUP', thirdPlace: false, rngSeed: 3 });
    assertBracket(specs, comps, false, 'mesmo grupo');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('todos contra todos', () => {
  it('N = 2..64, 100, 128: cada par exatamente 1 vez, N(N-1)/2 lutas, <=1 luta por atleta por rodada', () => {
    for (const n of SIZES) {
      const seeds = n > 64 ? RNG_SEEDS.slice(0, 2) : RNG_SEEDS;
      for (const rngSeed of seeds) {
        const comps = competitors(n);
        const specs = generateRoundRobin(comps, { rngSeed });
        const label = `N=${n} rngSeed=${rngSeed}`;
        assert.equal(specs.length, (n * (n - 1)) / 2, `${label}: total de lutas`);
        assert.equal(new Set(specs.map((m) => m.key)).size, specs.length, `${label}: keys únicas`);
        const pairs = new Set<string>();
        const perRound = new Map<number, Set<Id>>();
        const positions = new Map<number, number[]>();
        for (const m of specs) {
          assert.equal(m.stage, 'GROUP');
          assert.equal(m.groupIndex, 0);
          assert.equal(m.isBye, false);
          assert.equal(m.winnerId, null);
          assert.equal(m.next, null);
          assert.equal(m.loserNext, null);
          assert.ok(m.slotA !== null && m.slotB !== null && m.slotA !== m.slotB, `${label}: ${m.key} atletas inválidos`);
          assert.equal(m.key, `GROUP-0-${m.round}-${m.position}`);
          const pair = [m.slotA as number, m.slotB as number].sort((a, b) => a - b).join('-');
          assert.ok(!pairs.has(pair), `${label}: par ${pair} repetido`);
          pairs.add(pair);
          const used = perRound.get(m.round) ?? new Set<Id>();
          assert.ok(!used.has(m.slotA as number) && !used.has(m.slotB as number), `${label}: atleta com 2 lutas na rodada ${m.round}`);
          used.add(m.slotA as number);
          used.add(m.slotB as number);
          perRound.set(m.round, used);
          positions.set(m.round, [...(positions.get(m.round) ?? []), m.position]);
        }
        assert.equal(pairs.size, (n * (n - 1)) / 2);
        const expectedRounds = n % 2 === 0 ? n - 1 : n;
        assert.equal(perRound.size, expectedRounds, `${label}: nº de rodadas`);
        assert.deepEqual([...perRound.keys()].sort((a, b) => a - b), Array.from({ length: expectedRounds }, (_, i) => i + 1));
        for (const [, ps] of positions) {
          assert.deepEqual([...ps].sort((a, b) => a - b), ps.map((_, i) => i), `${label}: posições contíguas a partir de 0`);
        }
        // N ímpar: a folga fantasma NÃO vira luta (cada rodada tem (N-1)/2 lutas).
        if (n % 2 === 1) for (const [, used] of perRound) assert.equal(used.size, n - 1);
      }
    }
  });

  it('determinismo por rngSeed; seeds diferentes embaralham', () => {
    const comps = competitors(9);
    assert.deepEqual(generateRoundRobin(comps, { rngSeed: 4 }), generateRoundRobin(comps, { rngSeed: 4 }));
    assert.notDeepEqual(generateRoundRobin(comps, { rngSeed: 4 }), generateRoundRobin(comps, { rngSeed: 5 }));
  });

  it('N=3 e N=4 (exemplo fixo do método do círculo, ordem sorteada por rngSeed)', () => {
    const three = generateRoundRobin(competitors(3), { rngSeed: 1 });
    assert.equal(three.length, 3);
    assert.deepEqual(three.map((m) => m.round), [1, 2, 3]); // 1 luta por rodada, o terceiro descansa
    const four = generateRoundRobin(competitors(4), { rngSeed: 1 });
    assert.deepEqual(four.map((m) => m.round), [1, 1, 2, 2, 3, 3]);
    assert.deepEqual(four.map((m) => m.position), [0, 1, 0, 1, 0, 1]);
  });

  it('menos de 2 atletas ou id repetido lançam erro', () => {
    assert.throws(() => generateRoundRobin(competitors(1), { rngSeed: 1 }));
    assert.throws(() => generateRoundRobin([{ id: 1, seed: null, groupName: null }, { id: 1, seed: null, groupName: null }], { rngSeed: 1 }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('grupos (serpentina)', () => {
  it('exemplo fixo: 8 atletas com sementes 1..8 em 3 grupos => [1,6,7] [2,5,8] [3,4]', () => {
    const r = generateGroups(competitors(8, { seeded: true, base: 1 }), { groupCount: 3, seeding: 'BY_SEED', rngSeed: 1 });
    assert.deepEqual(r.groups, [[1, 6, 7], [2, 5, 8], [3, 4]]);
    // 3 + 3 + 1 lutas
    assert.equal(r.matches.length, 3 + 3 + 1);
    assert.equal(r.matches.filter((m) => m.groupIndex === 2).length, 1);
    assert.deepEqual(r.matches.filter((m) => m.groupIndex === 2).map((m) => [m.key, m.slotA, m.slotB]), [['GROUP-2-1-0', 3, 4]]);
  });

  it('exemplo fixo: 2 grupos de 4 (sementes 1..8) => [1,4,5,8] [2,3,6,7]', () => {
    const r = generateGroups(competitors(8, { seeded: true, base: 1 }), { groupCount: 2, seeding: 'BY_SEED', rngSeed: 1 });
    assert.deepEqual(r.groups, [[1, 4, 5, 8], [2, 3, 6, 7]]);
  });

  it('propriedades: tamanhos diferem <=1, todo atleta em exatamente 1 grupo, cada grupo é todos-contra-todos', () => {
    for (const groupCount of [2, 3, 4, 5, 7, 8, 16]) {
      for (const n of [groupCount, groupCount + 1, groupCount * 2 - 1, groupCount * 3, 33, 50, 64, 100, 128].filter((x) => x >= groupCount)) {
        for (const seeding of SEEDINGS) {
          for (const rngSeed of RNG_SEEDS.slice(0, 3)) {
            const comps = competitors(n, { seeded: seeding === 'BY_SEED', groupOf: (i) => `Academia${i % 6}` });
            const r = generateGroups(comps, { groupCount, seeding, rngSeed });
            const label = `G=${groupCount} N=${n} ${seeding} rngSeed=${rngSeed}`;
            assert.equal(r.groups.length, groupCount, label);
            const sizes = r.groups.map((g) => g.length);
            assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${label}: tamanhos ${sizes}`);
            assert.deepEqual(r.groups.flat().sort((a, b) => a - b), comps.map((c) => c.id).sort((a, b) => a - b), `${label}: cada atleta em exatamente 1 grupo`);
            let expected = 0;
            r.groups.forEach((ids, g) => {
              const ms = r.matches.filter((m) => m.groupIndex === g);
              assert.equal(ms.length, (ids.length * (ids.length - 1)) / 2, `${label}: grupo ${g} nº de lutas`);
              const pairs = new Set(ms.map((m) => [m.slotA as number, m.slotB as number].sort((a, b) => a - b).join('-')));
              assert.equal(pairs.size, ms.length, `${label}: grupo ${g} pares repetidos`);
              for (const m of ms) {
                assert.ok(ids.includes(m.slotA as number) && ids.includes(m.slotB as number), `${label}: luta fora do grupo`);
                assert.equal(m.stage, 'GROUP');
                assert.match(m.key, new RegExp(`^GROUP-${g}-\\d+-\\d+$`));
                assert.equal(m.next, null);
              }
              // <=1 luta por atleta por rodada
              const byRound = new Map<number, Id[]>();
              for (const m of ms) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m.slotA as number, m.slotB as number]);
              for (const [, used] of byRound) assert.equal(new Set(used).size, used.length, `${label}: atleta 2x na rodada`);
              expected += ms.length;
            });
            assert.equal(r.matches.length, expected);
            assert.equal(new Set(r.matches.map((m) => m.key)).size, r.matches.length, `${label}: keys únicas`);
          }
        }
      }
    }
  });

  it('BY_SEED: cabeças de chave caem em grupos diferentes (as G primeiras sementes, uma por grupo)', () => {
    const r = generateGroups(competitors(24, { seeded: true, base: 1 }), { groupCount: 6, seeding: 'BY_SEED', rngSeed: 3 });
    r.groups.forEach((g, i) => assert.equal(g[0], i + 1));
  });

  it('AVOID_SAME_GROUP: 4 academias de 4 atletas em 4 grupos => cada grupo recebe 1 de cada', () => {
    const comps = competitors(16, { groupOf: (i) => `Academia${i % 4}` });
    for (const rngSeed of RNG_SEEDS) {
      const r = generateGroups(comps, { groupCount: 4, seeding: 'AVOID_SAME_GROUP', rngSeed });
      for (const g of r.groups) {
        const academies = g.map((id) => comps.find((c) => c.id === id)!.groupName);
        assert.equal(new Set(academies).size, 4, `rngSeed=${rngSeed}: academias repetidas no grupo ${academies}`);
      }
    }
  });

  it('AVOID_SAME_GROUP: nunca mais que ⌈tamanho da academia / grupos⌉ da mesma academia no mesmo grupo', () => {
    for (const [n, groupCount] of [[20, 4], [23, 5], [30, 3], [17, 2]] as const) {
      const comps = competitors(n, { groupOf: (i) => (i < Math.floor(n / 2) ? 'Grande' : `Pequena${i % 3}`) });
      for (const rngSeed of RNG_SEEDS) {
        const r = generateGroups(comps, { groupCount, seeding: 'AVOID_SAME_GROUP', rngSeed });
        const total = new Map<string, number>();
        comps.forEach((c) => total.set(c.groupName as string, (total.get(c.groupName as string) ?? 0) + 1));
        for (const g of r.groups) {
          const here = new Map<string, number>();
          g.forEach((id) => {
            const name = comps.find((c) => c.id === id)!.groupName as string;
            here.set(name, (here.get(name) ?? 0) + 1);
          });
          for (const [name, c] of here) {
            assert.ok(c <= Math.ceil((total.get(name) as number) / groupCount), `N=${n} G=${groupCount} rngSeed=${rngSeed}: ${name} x${c} no mesmo grupo`);
          }
        }
      }
    }
  });

  it('determinismo por rngSeed e erros de entrada', () => {
    const comps = competitors(30, { groupOf: (i) => `A${i % 5}` });
    for (const seeding of SEEDINGS) {
      assert.deepEqual(generateGroups(comps, { groupCount: 4, seeding, rngSeed: 9 }), generateGroups(comps, { groupCount: 4, seeding, rngSeed: 9 }));
    }
    assert.notDeepEqual(
      generateGroups(comps, { groupCount: 4, seeding: 'RANDOM', rngSeed: 9 }).groups,
      generateGroups(comps, { groupCount: 4, seeding: 'RANDOM', rngSeed: 10 }).groups,
    );
    assert.throws(() => generateGroups(competitors(3), { groupCount: 4, seeding: 'RANDOM', rngSeed: 1 }));
    assert.throws(() => generateGroups(competitors(8), { groupCount: 0, seeding: 'RANDOM', rngSeed: 1 }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('classificação (computeStandings)', () => {
  const win = (a: number, b: number, winner: number, sa: number | null = null, sb: number | null = null, resultType: MatchResult['resultType'] = 'NORMAL'): MatchResult => ({
    slotA: a, slotB: b, winnerId: winner, scoreA: sa, scoreB: sb, resultType,
  });
  const draw = (a: number, b: number, sa: number | null = null, sb: number | null = null): MatchResult => ({
    slotA: a, slotB: b, winnerId: null, scoreA: sa, scoreB: sb, resultType: 'DRAW',
  });
  const order = (rows: ReturnType<typeof computeStandings>) => rows.map((r) => r.competitorId);

  it('pontos 3/1/0, jogos, pró/contra e rank 1..n', () => {
    const rows = computeStandings([1, 2, 3], [win(1, 2, 1, 3, 1), win(1, 3, 1, 2, 0), win(2, 3, 2, 1, 0)]);
    assert.deepEqual(rows, [
      { competitorId: 1, played: 2, wins: 2, draws: 0, losses: 0, pointsFor: 5, pointsAgainst: 1, points: 6, rank: 1 },
      { competitorId: 2, played: 2, wins: 1, draws: 0, losses: 1, pointsFor: 2, pointsAgainst: 3, points: 3, rank: 2 },
      { competitorId: 3, played: 2, wins: 0, draws: 0, losses: 2, pointsFor: 0, pointsAgainst: 3, points: 0, rank: 3 },
    ]);
  });

  it('sem resultados: todos com 0, desempate por seed (null por último) e depois por id', () => {
    const seeds = new Map<number, number | null>([[7, 2], [5, 1], [9, null], [3, null]]);
    assert.deepEqual(order(computeStandings([9, 3, 5, 7], [], undefined, seeds)), [5, 7, 3, 9]);
    assert.deepEqual(order(computeStandings([9, 3, 5, 7], [])), [3, 5, 7, 9]);
    const rows = computeStandings([4, 2], []);
    assert.deepEqual(rows.map((r) => r.rank), [1, 2]);
  });

  it('empate de 2 decidido por confronto direto (e o id sozinho daria a ordem inversa)', () => {
    // 1 e 2 empatam em pontos (6), vitórias (2), saldo (+1) e pró (2); 2 venceu 1.
    const results = [win(1, 2, 2, 0, 1), win(1, 3, 1, 1, 0), win(1, 4, 1, 1, 0), win(2, 3, 2, 1, 0), win(2, 4, 4, 0, 1), win(3, 4, 3, 3, 0)];
    const rows = computeStandings([1, 2, 3, 4], results);
    const [r1, r2] = [rows.find((r) => r.competitorId === 1)!, rows.find((r) => r.competitorId === 2)!];
    assert.deepEqual([r1.points, r1.wins, r1.pointsFor - r1.pointsAgainst, r1.pointsFor], [6, 2, 1, 2]);
    assert.deepEqual([r2.points, r2.wins, r2.pointsFor - r2.pointsAgainst, r2.pointsFor], [6, 2, 1, 2]);
    assert.deepEqual(order(rows), [2, 1, 3, 4]);
    // Espelhando 1 e 2, o confronto direto passa a favorecer o 1: a ordem é [1,2,3,4].
    const swap = (id: number | null) => (id === 1 ? 2 : id === 2 ? 1 : id);
    const mirrored = results.map((r) => ({ ...r, slotA: swap(r.slotA) as number, slotB: swap(r.slotB) as number, winnerId: swap(r.winnerId) }));
    assert.deepEqual(order(computeStandings([1, 2, 3, 4], mirrored)), [1, 2, 3, 4]);
  });

  it('3 empatados (ciclo 1>2>3>1): confronto direto NÃO vale; desempata por seed e depois por id', () => {
    const results = [win(1, 2, 1, 1, 0), win(2, 3, 2, 1, 0), win(3, 1, 3, 1, 0)];
    assert.deepEqual(order(computeStandings([1, 2, 3], results)), [1, 2, 3]);
    const seeds = new Map<number, number | null>([[1, 3], [2, 2], [3, 1]]);
    assert.deepEqual(order(computeStandings([1, 2, 3], results, undefined, seeds)), [3, 2, 1]);
  });

  it('confronto direto empatado (empate entre os dois) cai para seed/id', () => {
    const rows = computeStandings([2, 1], [draw(1, 2, 1, 1)]);
    assert.deepEqual(order(rows), [1, 2]);
    assert.equal(rows[0].points, 1);
    assert.equal(rows[0].draws, 1);
  });

  it('empates: 1 ponto cada, played/draws, sem vencedor, saldo conta os scores', () => {
    const rows = computeStandings([1, 2, 3], [draw(1, 2, 2, 2), win(3, 1, 3, 1, 0)]);
    const byId = new Map(rows.map((r) => [r.competitorId, r]));
    assert.equal(byId.get(1)!.points, 1);
    assert.equal(byId.get(2)!.points, 1);
    assert.equal(byId.get(3)!.points, 3);
    assert.equal(byId.get(1)!.pointsFor, 2);
    assert.equal(byId.get(1)!.pointsAgainst, 3);
    assert.equal(rows[0].competitorId, 3);
  });

  it('W.O. e desclassificação = vitória do adversário e NUNCA entram no saldo (contrato §3), mesmo com placar informado', () => {
    const rows = computeStandings([1, 2, 3], [win(1, 2, 2, null, null, 'WALKOVER'), win(1, 3, 1, 5, 0, 'DISQUALIFICATION')]);
    const byId = new Map(rows.map((r) => [r.competitorId, r]));
    assert.deepEqual([byId.get(2)!.wins, byId.get(2)!.points, byId.get(2)!.pointsFor, byId.get(2)!.pointsAgainst], [1, 3, 0, 0]);
    assert.deepEqual([byId.get(1)!.wins, byId.get(1)!.losses, byId.get(1)!.points, byId.get(1)!.pointsFor, byId.get(1)!.pointsAgainst], [1, 1, 3, 0, 0]);
    assert.deepEqual([byId.get(3)!.losses, byId.get(3)!.points], [1, 0]);
  });

  it('precedência: pontos > vitórias > saldo > pró', () => {
    // vitórias antes do saldo: P = 3 empates (3 pts, 0 vitórias, saldo 0) × Q = 1 vitória + 2 derrotas (3 pts, 1 vitória, saldo -9)
    const pq = computeStandings([10, 20, 31, 32, 33], [
      draw(10, 31, 0, 0), draw(10, 32, 0, 0), draw(10, 33, 0, 0),
      win(20, 31, 20, 1, 0), win(32, 20, 32, 10, 0), win(33, 20, 33, 10, 0),
    ]);
    const p = pq.find((r) => r.competitorId === 10)!;
    const q = pq.find((r) => r.competitorId === 20)!;
    assert.equal(p.points, 3);
    assert.equal(q.points, 3);
    assert.ok(q.rank < p.rank, 'mais vitórias vence apesar do pior saldo');
    // saldo antes do pró: X vence 10-9 (saldo +1, pró 10); Y vence 2-0 (saldo +2, pró 2)
    const sd = computeStandings([1, 2, 3, 4], [win(1, 3, 1, 10, 9), win(2, 4, 2, 2, 0)]);
    assert.deepEqual(order(sd).slice(0, 2), [2, 1]);
    // pró (saldo igual): 9 vence 5-4 e 3 vence 2-1 — o id daria 3 antes de 9; o pró põe o 9 na frente
    const pf = computeStandings([9, 3, 7, 8], [win(9, 7, 9, 5, 4), win(3, 8, 3, 2, 1)]);
    assert.deepEqual(order(pf).slice(0, 2), [9, 3]);
  });

  it('resultados de atletas fora de ids, contra si mesmos ou sem decisão são ignorados', () => {
    const rows = computeStandings([1, 2], [
      win(1, 99, 1, 3, 0),
      win(1, 1, 1),
      { slotA: 1, slotB: 2, winnerId: null, scoreA: 1, scoreB: 1, resultType: 'NORMAL' },
      { slotA: 1, slotB: 2, winnerId: 55, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
    ]);
    assert.ok(rows.every((r) => r.played === 0 && r.points === 0));
  });

  it('regras de pontos customizadas e ids duplicados na entrada', () => {
    const rows = computeStandings([1, 2, 1], [win(1, 2, 1), draw(1, 2)], { pointsWin: 2, pointsDraw: 1, pointsLoss: 0 });
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.competitorId === 1)!.points, 3);
    assert.equal(rows.find((r) => r.competitorId === 2)!.points, 1);
  });

  it('round-robin completo: ranking coerente (rank único 1..n, soma de pontos = 3 × lutas decididas)', () => {
    const comps = competitors(7);
    const rr = generateRoundRobin(comps, { rngSeed: 11 });
    const rng = createRng(5);
    const results: MatchResult[] = rr.map((m) => {
      const x = rng();
      if (x < 0.2) return draw(m.slotA as number, m.slotB as number, 1, 1);
      return win(m.slotA as number, m.slotB as number, x < 0.6 ? (m.slotA as number) : (m.slotB as number), 2, 1);
    });
    const rows = computeStandings(comps.map((c) => c.id), results);
    assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(new Set(rows.map((r) => r.competitorId)).size, 7);
    const draws = results.filter((r) => r.resultType === 'DRAW').length;
    assert.equal(rows.reduce((s, r) => s + r.points, 0), 3 * (results.length - draws) + 2 * draws);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].points >= rows[i].points);
    for (const r of rows) assert.equal(r.played, 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('avanço (resolveAdvancement)', () => {
  it('vencedor vai para next; perdedor para loserNext quando há loserId', () => {
    const match = { next: { key: 'MAIN-3-0', slot: 'A' as const }, loserNext: { key: 'THIRD_PLACE-3-0', slot: 'B' as const } };
    assert.deepEqual(resolveAdvancement(match, { winnerId: 10, loserId: 20 }), [
      { matchKey: 'MAIN-3-0', slot: 'A', competitorId: 10 },
      { matchKey: 'THIRD_PLACE-3-0', slot: 'B', competitorId: 20 },
    ]);
  });
  it('loserId nulo (empate/folga) não gera atualização do perdedor; sem loserNext idem', () => {
    const match = { next: { key: 'MAIN-3-0', slot: 'B' as const }, loserNext: { key: 'THIRD_PLACE-3-0', slot: 'A' as const } };
    assert.deepEqual(resolveAdvancement(match, { winnerId: 10, loserId: null }), [{ matchKey: 'MAIN-3-0', slot: 'B', competitorId: 10 }]);
    assert.deepEqual(resolveAdvancement({ next: { key: 'X-2-0', slot: 'A' }, loserNext: null }, { winnerId: 1, loserId: 2 }), [
      { matchKey: 'X-2-0', slot: 'A', competitorId: 1 },
    ]);
  });
  it('final / 3º lugar / jogo de grupo (sem next e sem loserNext) => nenhuma atualização', () => {
    assert.deepEqual(resolveAdvancement({ next: null, loserNext: null }, { winnerId: 1, loserId: 2 }), []);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
type SimMatch = MatchSpec & { status: PodiumMatch['status'] };

/** Simula o serviço: decide as lutas na ordem, aplicando resolveAdvancement (o que o serviço gravaria). */
function simulate(specs: MatchSpec[], rng: () => number, stopAfterRound?: number): Map<string, SimMatch> {
  const byKey = new Map<string, SimMatch>(specs.map((s) => [s.key, { ...s, status: s.isBye ? 'FINISHED' : 'PENDING' }]));
  const order = [...byKey.values()].sort(
    (a, b) => (a.stage === 'THIRD_PLACE' ? 1 : 0) - (b.stage === 'THIRD_PLACE' ? 1 : 0) || a.round - b.round || a.position - b.position,
  );
  for (const m of order) {
    if (m.status === 'FINISHED') continue;
    if (stopAfterRound !== undefined && m.round > stopAfterRound) break;
    assert.ok(m.slotA !== null && m.slotB !== null, `${m.key} chegou sem os dois atletas`);
    const aWins = rng() < 0.5;
    const winnerId = (aWins ? m.slotA : m.slotB) as number;
    const loserId = (aWins ? m.slotB : m.slotA) as number;
    m.winnerId = winnerId;
    m.status = 'FINISHED';
    for (const u of resolveAdvancement(m, { winnerId, loserId })) {
      const target = byKey.get(u.matchKey);
      assert.ok(target, `${m.key}: destino ${u.matchKey} inexistente`);
      const cur = u.slot === 'A' ? target.slotA : target.slotB;
      assert.equal(cur, null, `${m.key}: slot ${u.matchKey}#${u.slot} já ocupado`);
      if (u.slot === 'A') target.slotA = u.competitorId;
      else target.slotB = u.competitorId;
    }
  }
  return byKey;
}

const asPodiumMatches = (sim: Map<string, SimMatch>): PodiumMatch[] =>
  [...sim.values()].map((m) => ({ key: m.key, stage: m.stage, round: m.round, status: m.status, slotA: m.slotA, slotB: m.slotB, winnerId: m.winnerId, isBye: m.isBye }));

describe('avanço: torneio inteiro simulado', () => {
  it('N=13 com 3º lugar: a final recebe 2 atletas, há campeão e pódio completo', () => {
    for (const seeding of SEEDINGS) {
      for (const rngSeed of RNG_SEEDS) {
        const comps = competitors(13, { seeded: seeding === 'BY_SEED', groupOf: (i) => `G${i % 3}` });
        const specs = generateSingleElimination(comps, { seeding, thirdPlace: true, rngSeed });
        const sim = simulate(specs, createRng(rngSeed + 1000));
        const final = sim.get('MAIN-4-0')!;
        assert.ok(final.slotA !== null && final.slotB !== null && final.slotA !== final.slotB, 'final com 2 atletas');
        assert.equal(final.status, 'FINISHED');
        assert.ok(final.winnerId !== null, 'há campeão');
        const third = sim.get('THIRD_PLACE-4-0')!;
        assert.ok(third.slotA !== null && third.slotB !== null);
        assert.equal(third.status, 'FINISHED');
        // Os dois da disputa de 3º são exatamente os perdedores das semifinais.
        const semiLosers = [sim.get('MAIN-3-0')!, sim.get('MAIN-3-1')!].map((s) => (s.winnerId === s.slotA ? s.slotB : s.slotA));
        assert.deepEqual([third.slotA, third.slotB].sort(), [...semiLosers].sort());
        // Todo atleta jogou/avançou de forma consistente: cada luta real tem os 2 lados preenchidos.
        for (const m of sim.values()) if (!m.isBye) assert.ok(m.slotA !== null && m.slotB !== null, m.key);
        const podium = computePodium({ format: 'SINGLE_ELIMINATION', thirdPlace: true, matches: asPodiumMatches(sim), standings: [] });
        assert.deepEqual(podium.map((p) => p.place), [1, 2, 3]);
        assert.equal(new Set(podium.map((p) => p.competitorId)).size, 3);
        assert.equal(podium[0].competitorId, final.winnerId);
      }
    }
  });

  it('todos os tamanhos 2..64, 100, 128: o torneio simulado sempre termina com final de 2 atletas e pódio', () => {
    for (const n of SIZES) {
      for (const thirdPlace of [false, true]) {
        const comps = competitors(n, { groupOf: (i) => `G${i % 5}` });
        const specs = generateSingleElimination(comps, { seeding: 'AVOID_SAME_GROUP', thirdPlace, rngSeed: n });
        const sim = simulate(specs, createRng(n * 31));
        const rounds = Math.log2(pow2(n));
        const final = sim.get(`MAIN-${rounds}-0`)!;
        assert.ok(final.winnerId !== null && final.slotA !== null && final.slotB !== null, `N=${n}`);
        assert.ok([...sim.values()].every((m) => m.status === 'FINISHED'), `N=${n}: tudo decidido`);
        const podium = computePodium({ format: 'SINGLE_ELIMINATION', thirdPlace, matches: asPodiumMatches(sim), standings: [] });
        assert.equal(podium[0].place, 1);
        assert.equal(podium[0].competitorId, final.winnerId);
        assert.equal(podium[1].place, 2);
        assert.equal(new Set(podium.map((p) => p.competitorId)).size, podium.length, `N=${n}: pódio sem repetidos`);
        const expectedLen = n === 2 ? 2 : thirdPlace && n >= 4 ? 3 : n === 3 ? 3 : 4;
        assert.equal(podium.length, expectedLen, `N=${n} 3º=${thirdPlace}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('mata-mata a partir dos grupos (buildKnockoutFromGroups)', () => {
  const view = (specs: MatchSpec[]) => specs.filter((m) => m.round === 1).map((m) => [m.key, m.slotA, m.slotB, m.isBye]);

  it('exemplo fixo: 2 grupos, 2 avançam => 1ºA×2ºB e 1ºB×2ºA; semifinais com 3º lugar', () => {
    const groups = [[11, 12, 13, 14], [21, 22, 23, 24]];
    const specs = buildKnockoutFromGroups(groups, { advancePerGroup: 2, thirdPlace: true, rngSeed: 1 });
    assert.deepEqual(view(specs), [
      ['MAIN-1-0', 11, 22, false],
      ['MAIN-1-1', 21, 12, false],
    ]);
    assert.deepEqual(specs.map((m) => m.key), ['MAIN-1-0', 'MAIN-1-1', 'MAIN-2-0', 'THIRD_PLACE-2-0']);
    assert.deepEqual(specs.find((m) => m.key === 'MAIN-1-0')!.loserNext, { key: 'THIRD_PLACE-2-0', slot: 'A' });
  });

  it('exemplo fixo: 4 grupos, 1 avança => 1ºA×1ºD e 1ºB×1ºC (1ºs em lados opostos)', () => {
    const specs = buildKnockoutFromGroups([[1, 2], [3, 4], [5, 6], [7, 8]], { advancePerGroup: 1, thirdPlace: false, rngSeed: 1 });
    assert.deepEqual(view(specs), [
      ['MAIN-1-0', 1, 7, false],
      ['MAIN-1-1', 3, 5, false],
    ]);
  });

  it('3 grupos × 2: tem folgas (6 classificados) e a rodada 1 não repete grupo (1ºC×2ºC da ordem padrão é evitado)', () => {
    const specs = buildKnockoutFromGroups([[1, 2], [3, 4], [5, 6]], { advancePerGroup: 2, thirdPlace: false, rngSeed: 1 });
    assert.equal(specs.filter((m) => m.isBye).length, 2);
    const groupOf = (id: number) => Math.floor((id - 1) / 2);
    for (const m of specs.filter((x) => x.round === 1 && !x.isBye)) assert.notEqual(groupOf(m.slotA as number), groupOf(m.slotB as number));
    // Folgas para os melhores cabeças: os 1ºs de A e B (ids 1 e 3)
    assert.deepEqual(specs.filter((m) => m.isBye).map((m) => m.winnerId).sort(), [1, 3]);
  });

  it('propriedades: grupos 2..16 × 1..4 avançam: classificados 1x cada, chave válida, sem confronto do mesmo grupo na rodada 1', () => {
    const offenders: string[] = [];
    for (let groupCount = 2; groupCount <= 16; groupCount++) {
      for (let adv = 1; adv <= 4; adv++) {
        if (groupCount * adv < 2) continue;
        const groups = Array.from({ length: groupCount }, (_, g) => Array.from({ length: adv + 1 }, (_, k) => (g + 1) * 100 + k + 1));
        for (const thirdPlace of [false, true]) {
          const specs = buildKnockoutFromGroups(groups, { advancePerGroup: adv, thirdPlace, rngSeed: 7 });
          const qualified = groups.flatMap((g) => g.slice(0, adv));
          const comps: EngineCompetitor[] = qualified.map((id) => ({ id, seed: null, groupName: null }));
          assertBracket(specs, comps, thirdPlace, `G=${groupCount} adv=${adv}`);
          assert.ok(specs.every((m) => m.key.startsWith('MAIN-') || m.key.startsWith('THIRD_PLACE-')));
          const groupOf = (id: number) => Math.floor(id / 100) - 1;
          for (const m of specs.filter((x) => x.round === 1 && x.slotA !== null && x.slotB !== null)) {
            if (groupOf(m.slotA as number) === groupOf(m.slotB as number)) offenders.push(`G=${groupCount} adv=${adv} ${m.key}`);
          }
          // os 1ºs de grupo A e B (primeiros cabeças) ficam em metades opostas
          if (groupCount >= 2 && qualified.length >= 4) {
            const rounds = Math.log2(pow2(qualified.length));
            const pos = (id: number) => round1PositionOf(specs, id);
            assert.notEqual(pos(101) >> (rounds - 2), pos(201) >> (rounds - 2), `G=${groupCount} adv=${adv}: 1ºs na mesma metade`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], 'confrontos do mesmo grupo na rodada 1');
  });

  it('grupos menores que advancePerGroup entram com o que têm; erros de entrada', () => {
    const specs = buildKnockoutFromGroups([[1], [2, 3]], { advancePerGroup: 2, thirdPlace: false, rngSeed: 1 });
    assert.equal(specs.filter((m) => !m.isBye).length, 2); // 3 classificados => 2 lutas reais
    assert.throws(() => buildKnockoutFromGroups([[1]], { advancePerGroup: 1, thirdPlace: false, rngSeed: 1 }));
    assert.throws(() => buildKnockoutFromGroups([[1, 2], [3, 4]], { advancePerGroup: 0, thirdPlace: false, rngSeed: 1 }));
    assert.throws(() => buildKnockoutFromGroups([[1, 2], [2, 3]], { advancePerGroup: 2, thirdPlace: false, rngSeed: 1 }));
  });

  it('é determinístico (mesma entrada => mesma chave)', () => {
    const groups = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    assert.deepEqual(
      buildKnockoutFromGroups(groups, { advancePerGroup: 2, thirdPlace: true, rngSeed: 3 }),
      buildKnockoutFromGroups(groups, { advancePerGroup: 2, thirdPlace: true, rngSeed: 3 }),
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('pódio (computePodium)', () => {
  const m = (key: string, over: Partial<PodiumMatch> = {}): PodiumMatch => ({
    key, stage: key.startsWith('THIRD') ? 'THIRD_PLACE' : key.startsWith('GROUP') ? 'GROUP' : 'MAIN', round: Number(key.split('-')[1]),
    status: 'FINISHED', slotA: null, slotB: null, winnerId: null, isBye: false, ...over,
  });
  const se = (matches: PodiumMatch[], thirdPlace: boolean) => computePodium({ format: 'SINGLE_ELIMINATION', thirdPlace, matches, standings: [] });

  // N=4: semis 1 x 4, 2 x 3; vencedores 1 e 2; final 1 x 2 => campeão 1; terceiro: 3 x 4
  const semis = [
    m('MAIN-1-0', { slotA: 1, slotB: 4, winnerId: 1 }),
    m('MAIN-1-1', { slotA: 2, slotB: 3, winnerId: 2 }),
  ];

  it('SINGLE_ELIMINATION com 3º lugar decidido => 1º, 2º, 3º', () => {
    const matches = [...semis, m('MAIN-2-0', { slotA: 1, slotB: 2, winnerId: 2 }), m('THIRD_PLACE-2-0', { slotA: 4, slotB: 3, winnerId: 3 })];
    assert.deepEqual(se(matches, true), [{ place: 1, competitorId: 2 }, { place: 2, competitorId: 1 }, { place: 3, competitorId: 3 }]);
  });

  it('com 3º lugar ligado mas ainda não decidido: só 1º e 2º (sem cair no empate de semifinais)', () => {
    const matches = [...semis, m('MAIN-2-0', { slotA: 1, slotB: 2, winnerId: 1 }), m('THIRD_PLACE-2-0', { status: 'READY', slotA: 4, slotB: 3 })];
    assert.deepEqual(se(matches, true), [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }]);
  });

  it('sem disputa de 3º: os DOIS perdedores das semifinais saem como 3º (dois itens place 3, em ordem de posição)', () => {
    const matches = [...semis, m('MAIN-2-0', { slotA: 1, slotB: 2, winnerId: 1 })];
    assert.deepEqual(se(matches, false), [
      { place: 1, competitorId: 1 }, { place: 2, competitorId: 2 },
      { place: 3, competitorId: 4 }, { place: 3, competitorId: 3 },
    ]);
  });

  it('vazio enquanto a final não está decidida (pendente, em andamento, ou finalizada sem vencedor)', () => {
    assert.deepEqual(se([...semis, m('MAIN-2-0', { status: 'PENDING' })], false), []);
    assert.deepEqual(se([...semis, m('MAIN-2-0', { status: 'LIVE', slotA: 1, slotB: 2 })], true), []);
    assert.deepEqual(se([...semis, m('MAIN-2-0', { status: 'READY', slotA: 1, slotB: 2, winnerId: 1 })], false), []);
    assert.deepEqual(se([], false), []);
  });

  it('N=2: a final é a única luta (apenas 1º e 2º, mesmo pedindo 3º lugar)', () => {
    assert.deepEqual(se([m('MAIN-1-0', { slotA: 5, slotB: 6, winnerId: 6 })], false), [{ place: 1, competitorId: 6 }, { place: 2, competitorId: 5 }]);
    assert.deepEqual(se([m('MAIN-1-0', { slotA: 5, slotB: 6, winnerId: 5 })], true), [{ place: 1, competitorId: 5 }, { place: 2, competitorId: 6 }]);
  });

  it('N=3: semifinal com folga; o perdedor da única semifinal real é o 3º (a folga não gera 3º)', () => {
    const matches = [
      m('MAIN-1-0', { slotA: 1, slotB: null, winnerId: 1, isBye: true }),
      m('MAIN-1-1', { slotA: 2, slotB: 3, winnerId: 3 }),
      m('MAIN-2-0', { slotA: 1, slotB: 3, winnerId: 1 }),
    ];
    for (const thirdPlace of [false, true]) {
      assert.deepEqual(se(matches, thirdPlace), [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 3 }, { place: 3, competitorId: 2 }]);
    }
  });

  it('GROUPS_KNOCKOUT: só o mata-mata (MAIN) conta; sem mata-mata gerado => vazio', () => {
    const group = [m('GROUP-0-1-0', { slotA: 1, slotB: 2, winnerId: 1 })];
    assert.deepEqual(computePodium({ format: 'GROUPS_KNOCKOUT', thirdPlace: true, matches: group, standings: [] }), []);
    const matches = [...group, ...semis, m('MAIN-2-0', { slotA: 1, slotB: 2, winnerId: 1 }), m('THIRD_PLACE-2-0', { slotA: 4, slotB: 3, winnerId: 4 })];
    assert.deepEqual(computePodium({ format: 'GROUPS_KNOCKOUT', thirdPlace: true, matches, standings: [] }), [
      { place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 4 },
    ]);
  });

  it('GROUPS_KNOCKOUT de verdade: grupos -> classificação -> mata-mata -> simulação => pódio', () => {
    const comps = competitors(11, { base: 1 });
    const g = generateGroups(comps, { groupCount: 3, seeding: 'RANDOM', rngSeed: 5 });
    const rng = createRng(77);
    const groupResults: MatchResult[] = g.matches.map((x) => ({
      slotA: x.slotA as number, slotB: x.slotB as number, winnerId: rng() < 0.5 ? (x.slotA as number) : (x.slotB as number), scoreA: null, scoreB: null, resultType: 'NORMAL',
    }));
    const ordered = g.groups.map((ids) => computeStandings(ids, groupResults.filter((r) => ids.includes(r.slotA) && ids.includes(r.slotB))).map((r) => r.competitorId));
    const ko = buildKnockoutFromGroups(ordered, { advancePerGroup: 2, thirdPlace: true, rngSeed: 5 });
    const sim = simulate(ko, createRng(3));
    const podium = computePodium({ format: 'GROUPS_KNOCKOUT', thirdPlace: true, matches: asPodiumMatches(sim), standings: [] });
    assert.deepEqual(podium.map((p) => p.place), [1, 2, 3]);
    const qualified = new Set(ordered.flatMap((o) => o.slice(0, 2)));
    for (const p of podium) assert.ok(qualified.has(p.competitorId));
  });

  it('ROUND_ROBIN: top 3 do ranking só quando TODAS as lutas terminaram', () => {
    const standings = computeStandings([1, 2, 3, 4], [
      { slotA: 1, slotB: 2, winnerId: 1, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
      { slotA: 1, slotB: 3, winnerId: 1, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
      { slotA: 1, slotB: 4, winnerId: 1, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
      { slotA: 2, slotB: 3, winnerId: 2, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
      { slotA: 2, slotB: 4, winnerId: 2, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
      { slotA: 3, slotB: 4, winnerId: 3, scoreA: 1, scoreB: 0, resultType: 'NORMAL' },
    ]);
    const games = ['GROUP-0-1-0', 'GROUP-0-1-1', 'GROUP-0-2-0', 'GROUP-0-2-1', 'GROUP-0-3-0', 'GROUP-0-3-1'].map((key) => m(key));
    const done = computePodium({ format: 'ROUND_ROBIN', thirdPlace: false, matches: games, standings });
    assert.deepEqual(done, [{ place: 1, competitorId: 1 }, { place: 2, competitorId: 2 }, { place: 3, competitorId: 3 }]);
    const open = games.map((g, i) => (i === 5 ? { ...g, status: 'LIVE' as const } : g));
    assert.deepEqual(computePodium({ format: 'ROUND_ROBIN', thirdPlace: false, matches: open, standings }), []);
    assert.deepEqual(computePodium({ format: 'ROUND_ROBIN', thirdPlace: false, matches: [], standings }), []);
  });

  it('ROUND_ROBIN com 2 atletas: só 1º e 2º', () => {
    const standings = computeStandings([8, 9], [{ slotA: 8, slotB: 9, winnerId: 9, scoreA: null, scoreB: null, resultType: 'WALKOVER' }]);
    const podium = computePodium({ format: 'ROUND_ROBIN', thirdPlace: false, matches: [m('GROUP-0-1-0')], standings });
    assert.deepEqual(podium, [{ place: 1, competitorId: 9 }, { place: 2, competitorId: 8 }]);
  });
});
