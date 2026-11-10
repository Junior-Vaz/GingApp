/**
 * Tipos do motor de chaveamento (docs/CONTRATO_CHAVEAMENTO.md §3).
 * O motor é PURO: nada de Prisma, Nest, Date.now() ou Math.random() (use o RNG com semente).
 * Qualquer mudança aqui exige mudar o contrato primeiro.
 */

export type Id = number;

export type TournamentFormat = 'SINGLE_ELIMINATION' | 'ROUND_ROBIN' | 'GROUPS_KNOCKOUT';
export type MatchStage = 'GROUP' | 'MAIN' | 'THIRD_PLACE';
export type Slot = 'A' | 'B';
export type ResultType = 'NORMAL' | 'WALKOVER' | 'DISQUALIFICATION' | 'DRAW';
export type Seeding = 'RANDOM' | 'BY_SEED' | 'AVOID_SAME_GROUP';

/** Atleta como o motor enxerga: só o necessário para sortear. */
export interface EngineCompetitor {
  id: Id;
  /** 1 = cabeça de chave. null = sem semente. */
  seed: number | null;
  /** Academia/grupo, usado para evitar confronto do mesmo grupo na 1ª rodada. */
  groupName: string | null;
}

/** Referência a outra luta ainda não criada no banco (a `key` é estável e única na categoria). */
export interface MatchLink {
  key: string;
  slot: Slot;
}

/** Luta gerada pelo motor. O serviço grava no banco e troca as `key` por ids. */
export interface MatchSpec {
  key: string;
  stage: MatchStage;
  /** 1-based. */
  round: number;
  /** 0-based dentro da rodada (e do grupo, quando stage = GROUP). */
  position: number;
  groupIndex: number | null;
  slotA: Id | null;
  slotB: Id | null;
  isBye: boolean;
  /** Preenchido só em luta de folga (bye): o único atleta presente. */
  winnerId: Id | null;
  /** Para onde o VENCEDOR vai. null na final / no 3º lugar / em jogos de grupo. */
  next: MatchLink | null;
  /** Para onde o PERDEDOR vai (semifinais -> disputa de 3º lugar). */
  loserNext: MatchLink | null;
}

export interface GenerateSingleEliminationOptions {
  seeding: Seeding;
  thirdPlace: boolean;
  /** Semente do RNG: mesma entrada + mesma semente = mesma chave. */
  rngSeed: number;
  /** Prefixo das keys (use 'MAIN' por padrão). */
  keyPrefix?: string;
}

export interface GenerateRoundRobinOptions {
  rngSeed: number;
}

export interface GenerateGroupsOptions {
  groupCount: number;
  seeding: Seeding;
  rngSeed: number;
}

export interface GroupsResult {
  /** ids dos atletas por grupo, na ordem da serpentina. */
  groups: Id[][];
  matches: MatchSpec[];
}

export interface BuildKnockoutFromGroupsOptions {
  advancePerGroup: number;
  thirdPlace: boolean;
  rngSeed: number;
}

/** Resultado mínimo de uma luta para classificação. */
export interface MatchResult {
  slotA: Id;
  slotB: Id;
  winnerId: Id | null;
  scoreA: number | null;
  scoreB: number | null;
  resultType: ResultType;
}

export interface StandingRules {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
}

export const DEFAULT_STANDING_RULES: StandingRules = { pointsWin: 3, pointsDraw: 1, pointsLoss: 0 };

export interface StandingRow {
  competitorId: Id;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number;
  /** 1-based, único (sem empates de posição: o desempate final é determinístico). */
  rank: number;
}

export interface SlotUpdate {
  matchKey: string;
  slot: Slot;
  competitorId: Id;
}

export interface PodiumEntry {
  place: 1 | 2 | 3;
  competitorId: Id;
}

/** Resultado de uma luta já decidida: o perdedor é null em empate/folga. */
export interface AdvancementOutcome {
  winnerId: Id;
  loserId: Id | null;
}

/** Visão mínima de uma luta para calcular o pódio. */
export interface PodiumMatch {
  key: string;
  stage: MatchStage;
  round: number;
  status: 'PENDING' | 'READY' | 'LIVE' | 'FINISHED';
  slotA: Id | null;
  slotB: Id | null;
  winnerId: Id | null;
  isBye: boolean;
}

export interface ComputePodiumInput {
  format: TournamentFormat;
  thirdPlace: boolean;
  matches: PodiumMatch[];
  /** Classificação geral (usada em ROUND_ROBIN, só quando TODAS as lutas terminaram). */
  standings: StandingRow[];
}

/**
 * Assinaturas públicas que `engine/index.ts` DEVE exportar (o serviço da API é escrito em paralelo contra elas):
 *
 *   generateSingleElimination(competitors: EngineCompetitor[], opts: GenerateSingleEliminationOptions): MatchSpec[]
 *   generateRoundRobin(competitors: EngineCompetitor[], opts: GenerateRoundRobinOptions): MatchSpec[]
 *   generateGroups(competitors: EngineCompetitor[], opts: GenerateGroupsOptions): GroupsResult
 *   computeStandings(ids: Id[], results: MatchResult[], rules?: StandingRules): StandingRow[]
 *   buildKnockoutFromGroups(orderedGroups: Id[][], opts: BuildKnockoutFromGroupsOptions): MatchSpec[]
 *       (orderedGroups[g] = ids do grupo g já em ordem de classificação; mata-mata usa `groupName` = `Grupo <g>` internamente)
 *   resolveAdvancement(match: { next: MatchLink | null; loserNext: MatchLink | null }, outcome: AdvancementOutcome): SlotUpdate[]
 *   computePodium(input: ComputePodiumInput): PodiumEntry[]   (vazio enquanto não houver final decidida)
 *   createRng(seed: number): () => number   (determinístico, [0,1))
 */
export type EnginePublicApi = never; // apenas documentação; o contrato real são as funções acima
