/**
 * Tipos do chaveamento de campeonato no painel (contrato: docs/CONTRATO_CHAVEAMENTO.md 4 e 6). São a VISÃO DO OPERADOR
 * devolvida pelo backend (`tournament-snapshot.ts`), não o snapshot público do telão. Datas chegam como string ISO.
 *
 * As listas `*_KEYS` abaixo são o conjunto EXATO de chaves de cada objeto: um teste compara com JSON real capturado do
 * backend (src/test/chaveamento-real.test.ts) e o compilador garante que a lista cobre todas as chaves do tipo.
 */

export type TournamentFormat = "SINGLE_ELIMINATION" | "ROUND_ROBIN" | "GROUPS_KNOCKOUT";
export type CategoryStatus = "SETUP" | "RUNNING" | "FINISHED";
export type MatchStage = "GROUP" | "MAIN" | "THIRD_PLACE";
export type MatchStatus = "PENDING" | "READY" | "LIVE" | "FINISHED";
export type ResultType = "NORMAL" | "WALKOVER" | "DISQUALIFICATION" | "DRAW";
export type AgeGroup = "ADULT" | "MINOR" | "UNKNOWN";
export type Seeding = "RANDOM" | "BY_SEED" | "AVOID_SAME_GROUP";
export type Slot = "A" | "B";

export const FORMATS: readonly TournamentFormat[] = ["SINGLE_ELIMINATION", "ROUND_ROBIN", "GROUPS_KNOCKOUT"];

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  SINGLE_ELIMINATION: "Eliminatória simples (mata-mata)",
  ROUND_ROBIN: "Todos contra todos",
  GROUPS_KNOCKOUT: "Grupos + mata-mata",
};

export const CATEGORY_STATUS_LABEL: Record<CategoryStatus, string> = {
  SETUP: "Montando",
  RUNNING: "Em andamento",
  FINISHED: "Encerrada",
};

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  PENDING: "Aguardando",
  READY: "Pronta",
  LIVE: "Ao vivo",
  FINISHED: "Encerrada",
};

export const RESULT_TYPE_LABEL: Record<ResultType, string> = {
  NORMAL: "Normal",
  WALKOVER: "W.O.",
  DISQUALIFICATION: "Desclassificação",
  DRAW: "Empate",
};

export const AGE_GROUP_LABEL: Record<AgeGroup, string> = {
  ADULT: "Maior de idade",
  MINOR: "Menor de idade",
  UNKNOWN: "Não sei",
};

export const SEEDING_LABEL: Record<Seeding, string> = {
  RANDOM: "Aleatório",
  BY_SEED: "Por sementes (cabeças de chave)",
  AVOID_SAME_GROUP: "Evitar mesmo grupo na 1ª rodada",
};

/** Limites do contrato (secção 1). */
export const LIMITS = {
  maxCategories: 40,
  maxCompetitors: 128,
  groupCountMin: 2,
  groupCountMax: 16,
  advanceMin: 1,
  advanceMax: 4,
  seedMax: 128,
  scoreMax: 999,
  matMax: 40,
  queueOrderMax: 9999,
  nameMax: 80,
  groupNameMax: 80,
  graduationMax: 60,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Torneio (GET /events/:id/tournament, PATCH, rotate-token)
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentCategorySummary {
  id: number;
  name: string;
  position: number;
  format: TournamentFormat;
  status: CategoryStatus;
  thirdPlace: boolean;
  groupCount: number | null;
  advancePerGroup: number | null;
  generatedAt: string | null;
  competitorsCount: number;
  matchesCount: number;
  liveMatchesCount: number;
  finishedMatchesCount: number;
}

export interface TournamentSummary {
  id: number;
  eventId: number;
  publicEnabled: boolean;
  publicToken: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  categories: TournamentCategorySummary[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Categoria (visão do operador)
// ---------------------------------------------------------------------------------------------------------------------

export interface OperatorCompetitor {
  id: number;
  displayName: string;
  groupName: string | null;
  graduationLabel: string | null;
  seed: number | null;
  poolIndex: number | null;
  studentId: number | null;
  eventParticipantId: number | null;
  photoUrl: string | null;
  ageGroup: AgeGroup;
  photoAuthorized: boolean;
  photoAuthorizedAt: string | null;
  /** A foto aparece no telão público? (adulto, ou menor/desconhecido com autorização) */
  photoPublic: boolean;
  createdAt: string;
}

export interface OperatorMatch {
  id: number;
  key: string;
  stage: MatchStage;
  round: number;
  position: number;
  groupIndex: number | null;
  slotAId: number | null;
  slotBId: number | null;
  nextMatchId: number | null;
  nextSlot: Slot | null;
  loserNextMatchId: number | null;
  loserNextSlot: Slot | null;
  isBye: boolean;
  status: MatchStatus;
  winnerId: number | null;
  scoreA: number | null;
  scoreB: number | null;
  resultType: ResultType | null;
  note: string | null;
  /** Tatame (número, 0..40); no telão público vira texto. */
  mat: number | null;
  queueOrder: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface StandingRow {
  competitorId: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  points: number;
  rank: number;
}

export interface StandingsGroup {
  groupIndex: number;
  rows: StandingRow[];
}

export interface PodiumEntry {
  place: 1 | 2 | 3;
  competitorId: number;
}

export interface OperatorCategory {
  id: number;
  tournamentId: number;
  revision: number;
  name: string;
  position: number;
  format: TournamentFormat;
  status: CategoryStatus;
  thirdPlace: boolean;
  groupCount: number | null;
  advancePerGroup: number | null;
  drawSeed: number | null;
  generatedAt: string | null;
  competitors: OperatorCompetitor[];
  matches: OperatorMatch[];
  standings: StandingsGroup[];
  podium: PodiumEntry[];
}

/** POST /categories/:cid/competitors/from-participants */
export interface ImportResult {
  added: number;
  skipped: number;
  category: OperatorCategory;
}

// ---------------------------------------------------------------------------------------------------------------------
// Corpos das mutações
// ---------------------------------------------------------------------------------------------------------------------

export interface CategoryPayload {
  name?: string | undefined;
  format?: TournamentFormat | undefined;
  thirdPlace?: boolean | undefined;
  groupCount?: number | null | undefined;
  advancePerGroup?: number | null | undefined;
}

export interface GuestPayload {
  displayName: string;
  groupName?: string | undefined;
  graduationLabel?: string | undefined;
  ageGroup?: AgeGroup | undefined;
  photoUrl?: string | undefined;
  /** 1..128; vai DENTRO de guest (seed no topo junto com guest = 400 INVALID_COMPETITOR). */
  seed?: number | undefined;
  photoAuthorized?: boolean | undefined;
}

/** Exatamente uma forma; nas formas studentId/eventParticipantId a semente vai no topo. */
export type AddCompetitorPayload =
  | { eventParticipantId: number; seed?: number | undefined }
  | { studentId: number; seed?: number | undefined }
  | { guest: GuestPayload };

export interface UpdateCompetitorPayload {
  displayName?: string | undefined;
  groupName?: string | null | undefined;
  graduationLabel?: string | null | undefined;
  seed?: number | null | undefined;
  ageGroup?: AgeGroup | undefined;
  photoAuthorized?: boolean | undefined;
  photoUrl?: string | null | undefined;
}

export interface ResultPayload {
  winnerId?: number | null | undefined;
  scoreA?: number | null | undefined;
  scoreB?: number | null | undefined;
  resultType?: ResultType | undefined;
  note?: string | null | undefined;
}

export interface MatchSchedulePayload {
  mat?: number | null | undefined;
  queueOrder?: number | null | undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conjuntos EXATOS de chaves (conformidade com o backend real)
// ---------------------------------------------------------------------------------------------------------------------

type AssertNever<T extends never> = T;

export const TOURNAMENT_KEYS = [
  "id", "eventId", "publicEnabled", "publicToken", "revision", "createdAt", "updatedAt", "categories",
] as const satisfies readonly (keyof TournamentSummary)[];
export type _TournamentKeysCoverAll = AssertNever<Exclude<keyof TournamentSummary, (typeof TOURNAMENT_KEYS)[number]>>;

export const CATEGORY_SUMMARY_KEYS = [
  "id", "name", "position", "format", "status", "thirdPlace", "groupCount", "advancePerGroup", "generatedAt",
  "competitorsCount", "matchesCount", "liveMatchesCount", "finishedMatchesCount",
] as const satisfies readonly (keyof TournamentCategorySummary)[];
export type _CategorySummaryKeysCoverAll = AssertNever<
  Exclude<keyof TournamentCategorySummary, (typeof CATEGORY_SUMMARY_KEYS)[number]>
>;

export const CATEGORY_KEYS = [
  "id", "tournamentId", "revision", "name", "position", "format", "status", "thirdPlace", "groupCount",
  "advancePerGroup", "drawSeed", "generatedAt", "competitors", "matches", "standings", "podium",
] as const satisfies readonly (keyof OperatorCategory)[];
export type _CategoryKeysCoverAll = AssertNever<Exclude<keyof OperatorCategory, (typeof CATEGORY_KEYS)[number]>>;

export const COMPETITOR_KEYS = [
  "id", "displayName", "groupName", "graduationLabel", "seed", "poolIndex", "studentId", "eventParticipantId",
  "photoUrl", "ageGroup", "photoAuthorized", "photoAuthorizedAt", "photoPublic", "createdAt",
] as const satisfies readonly (keyof OperatorCompetitor)[];
export type _CompetitorKeysCoverAll = AssertNever<Exclude<keyof OperatorCompetitor, (typeof COMPETITOR_KEYS)[number]>>;

export const MATCH_KEYS = [
  "id", "key", "stage", "round", "position", "groupIndex", "slotAId", "slotBId", "nextMatchId", "nextSlot",
  "loserNextMatchId", "loserNextSlot", "isBye", "status", "winnerId", "scoreA", "scoreB", "resultType", "note", "mat",
  "queueOrder", "startedAt", "finishedAt",
] as const satisfies readonly (keyof OperatorMatch)[];
export type _MatchKeysCoverAll = AssertNever<Exclude<keyof OperatorMatch, (typeof MATCH_KEYS)[number]>>;

export const STANDINGS_GROUP_KEYS = ["groupIndex", "rows"] as const satisfies readonly (keyof StandingsGroup)[];
export const STANDING_ROW_KEYS = [
  "competitorId", "played", "wins", "draws", "losses", "pointsFor", "pointsAgainst", "points", "rank",
] as const satisfies readonly (keyof StandingRow)[];
export type _StandingRowKeysCoverAll = AssertNever<Exclude<keyof StandingRow, (typeof STANDING_ROW_KEYS)[number]>>;
export const PODIUM_KEYS = ["place", "competitorId"] as const satisfies readonly (keyof PodiumEntry)[];

/** Corpo de erro do backend: `{ statusCode, message, code }` (validação de DTO vem sem `code`). */
export const ERROR_BODY_KEYS = ["statusCode", "message", "code"] as const;
