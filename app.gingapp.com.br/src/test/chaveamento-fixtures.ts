import type { PublicCategory, PublicCompetitor, PublicMatch, PublicSnapshot } from "@/lib/chaveamento/types";

/** Fábricas de snapshots sintéticos para os testes do telão (os formatos REAIS ficam em real-contract-chaveamento.ts). */

export function comp(id: number, over: Partial<PublicCompetitor> = {}): PublicCompetitor {
  return { id, name: `Atleta ${id}`, group: null, graduation: null, photoUrl: null, seed: null, poolIndex: null, ...over };
}

export function match(id: number, over: Partial<PublicMatch> = {}): PublicMatch {
  return {
    id,
    key: `MAIN-1-${id}`,
    stage: "MAIN",
    round: 1,
    position: 0,
    groupIndex: null,
    slotAId: null,
    slotBId: null,
    nextMatchId: null,
    nextSlot: null,
    isBye: false,
    status: "PENDING",
    winnerId: null,
    scoreA: null,
    scoreB: null,
    resultType: null,
    mat: null,
    queueOrder: null,
    ...over,
  };
}

export function category(id: number, over: Partial<PublicCategory> = {}): PublicCategory {
  return {
    id,
    name: `Categoria ${id}`,
    format: "SINGLE_ELIMINATION",
    status: "RUNNING",
    thirdPlace: false,
    competitors: [],
    matches: [],
    standings: [],
    podium: [],
    ...over,
  };
}

export function snapshot(revision: number, categories: PublicCategory[], over: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return {
    revision,
    serverTime: "2026-11-10T12:00:00.000Z",
    event: { title: "Campeonato Teste", date: "2026-11-11T12:00:00.000Z", location: "Ginásio", imageUrl: null },
    organizationName: "Grupo Teste",
    categories,
    ...over,
  };
}

/**
 * Mata-mata de N atletas no formato do motor do backend: P = próxima potência de 2; semente s enfrenta P+1-s; as P-N folgas
 * ficam com as melhores sementes (lutas de folga já FINISHED). Com `thirdPlace` e N >= 4, inclui a disputa de 3º lugar.
 * Ids sequenciais (rodada 1 até a final, depois o 3º lugar).
 */
export function buildKnockout(n: number, opts: { thirdPlace?: boolean } = {}): { competitors: PublicCompetitor[]; matches: PublicMatch[] } {
  let size = 1;
  while (size < n) size *= 2;
  const rounds = Math.log2(size);
  const competitors = Array.from({ length: n }, (_, i) => comp(i + 1, { seed: i + 1 }));
  const matches: PublicMatch[] = [];
  let nextId = 1;
  const idOf = new Map<string, number>();
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position += 1) idOf.set(`${round}-${position}`, nextId++);
  }
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position += 1) {
      const last = round === rounds;
      let slotAId: number | null = null;
      let slotBId: number | null = null;
      let isBye = false;
      if (round === 1) {
        const a = position + 1;
        const b = size - position;
        slotAId = a <= n ? a : null;
        slotBId = b <= n ? b : null;
        isBye = slotAId === null || slotBId === null;
      }
      matches.push(
        match(idOf.get(`${round}-${position}`)!, {
          key: `MAIN-${round}-${position}`,
          round,
          position,
          slotAId: isBye ? (slotAId ?? slotBId) : slotAId,
          slotBId: isBye ? null : slotBId,
          nextMatchId: last ? null : idOf.get(`${round + 1}-${Math.floor(position / 2)}`)!,
          nextSlot: last ? null : position % 2 === 0 ? "A" : "B",
          isBye,
          status: isBye ? "FINISHED" : round === 1 ? "READY" : "PENDING",
          winnerId: isBye ? (slotAId ?? slotBId) : null,
        }),
      );
    }
  }
  if (opts.thirdPlace && n >= 4) {
    matches.push(match(nextId, { key: `THIRD_PLACE-${rounds}-0`, stage: "THIRD_PLACE", round: rounds, position: 0 }));
  }
  return { competitors, matches };
}
