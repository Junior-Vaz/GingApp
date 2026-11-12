import type {
  OperatorCategory,
  OperatorCompetitor,
  OperatorMatch,
  TournamentSummary,
} from "@/modules/chaveamento/types";

/** Fábricas de dados do chaveamento para os testes (formato idêntico à visão real do operador). */
export function mkCompetitor(id: number, name: string, over: Partial<OperatorCompetitor> = {}): OperatorCompetitor {
  return {
    id,
    displayName: name,
    groupName: null,
    graduationLabel: null,
    seed: null,
    poolIndex: null,
    studentId: null,
    eventParticipantId: null,
    photoUrl: null,
    hasOwnPhoto: false,
    photoVersion: null,
    ageGroup: "ADULT",
    photoAuthorized: false,
    photoAuthorizedAt: null,
    photoPublic: false,
    createdAt: "2026-11-10T02:47:04.067Z",
    ...over,
  };
}

export function mkMatch(id: number, over: Partial<OperatorMatch> = {}): OperatorMatch {
  return {
    id,
    key: `MAIN-1-${String(id)}`,
    stage: "MAIN",
    round: 1,
    position: 0,
    groupIndex: null,
    slotAId: null,
    slotBId: null,
    nextMatchId: null,
    nextSlot: null,
    loserNextMatchId: null,
    loserNextSlot: null,
    isBye: false,
    status: "PENDING",
    winnerId: null,
    scoreA: null,
    scoreB: null,
    resultType: null,
    note: null,
    mat: null,
    queueOrder: null,
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

export function mkCategory(over: Partial<OperatorCategory> = {}): OperatorCategory {
  return {
    id: 5,
    tournamentId: 1,
    revision: 1,
    name: "Adulto até 70 kg",
    position: 0,
    format: "SINGLE_ELIMINATION",
    status: "SETUP",
    thirdPlace: false,
    groupCount: null,
    advancePerGroup: null,
    drawSeed: null,
    generatedAt: null,
    competitors: [],
    matches: [],
    standings: [],
    podium: [],
    ...over,
  };
}

export function mkTournament(over: Partial<TournamentSummary> = {}): TournamentSummary {
  return {
    id: 1,
    eventId: 7,
    publicEnabled: false,
    publicToken: "tok_abcdefghijklmnopqrstuvwx",
    revision: 1,
    createdAt: "2026-11-10T02:00:00.000Z",
    updatedAt: "2026-11-10T02:00:00.000Z",
    categories: [],
    ...over,
  };
}

/** Resumo de categoria como o GET / devolve. */
export function summaryOf(c: OperatorCategory): TournamentSummary["categories"][number] {
  const real = c.matches.filter((m) => !m.isBye);
  return {
    id: c.id,
    name: c.name,
    position: c.position,
    format: c.format,
    status: c.status,
    thirdPlace: c.thirdPlace,
    groupCount: c.groupCount,
    advancePerGroup: c.advancePerGroup,
    generatedAt: c.generatedAt,
    competitorsCount: c.competitors.length,
    matchesCount: real.length,
    liveMatchesCount: real.filter((m) => m.status === "LIVE").length,
    finishedMatchesCount: real.filter((m) => m.status === "FINISHED").length,
  };
}

/** Eliminatória simples completa (P = potência de 2) sem folgas, com 3º lugar opcional. Ids: a partir de 1000. */
export function buildBracket(size: number, thirdPlace = false): OperatorMatch[] {
  const rounds = Math.log2(size);
  const matches: OperatorMatch[] = [];
  const idOf = (round: number, position: number) => 1000 + round * 100 + position;
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round;
    for (let position = 0; position < count; position++) {
      const last = round === rounds;
      matches.push(
        mkMatch(idOf(round, position), {
          key: `MAIN-${String(round)}-${String(position)}`,
          round,
          position,
          nextMatchId: last ? null : idOf(round + 1, Math.floor(position / 2)),
          nextSlot: last ? null : position % 2 === 0 ? "A" : "B",
          loserNextMatchId: thirdPlace && round === rounds - 1 ? idOf(rounds, 99) : null,
          loserNextSlot: thirdPlace && round === rounds - 1 ? (position % 2 === 0 ? "A" : "B") : null,
        }),
      );
    }
  }
  if (thirdPlace && rounds >= 2) {
    matches.push(mkMatch(idOf(rounds, 99), { key: `THIRD_PLACE-${String(rounds)}-0`, stage: "THIRD_PLACE", round: rounds }));
  }
  return matches;
}
