/**
 * Snapshot PÚBLICO do telão de chaveamento (docs/CONTRATO_CHAVEAMENTO.md, seção 5).
 * Só existe aqui o que o backend publica: o app nunca lê nem mostra nenhum outro campo.
 * As listas de chaves abaixo são a verdade conferida pelo teste de conformidade com o JSON real do backend.
 */

export const TOURNAMENT_FORMATS = ["SINGLE_ELIMINATION", "ROUND_ROBIN", "GROUPS_KNOCKOUT"] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export const CATEGORY_STATUSES = ["SETUP", "RUNNING", "FINISHED"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export const MATCH_STAGES = ["GROUP", "MAIN", "THIRD_PLACE"] as const;
export type MatchStage = (typeof MATCH_STAGES)[number];

export const MATCH_STATUSES = ["PENDING", "READY", "LIVE", "FINISHED"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const RESULT_TYPES = ["NORMAL", "WALKOVER", "DISQUALIFICATION", "DRAW"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export type Slot = "A" | "B";

export interface PublicEvent {
  title: string;
  /** ISO. */
  date: string;
  location: string | null;
  imageUrl: string | null;
}

export interface PublicCompetitor {
  id: number;
  name: string;
  group: string | null;
  graduation: string | null;
  /** Só chega preenchida se o atleta é adulto ou tem a foto autorizada (o servidor decide; o app só obedece o null). */
  photoUrl: string | null;
  seed: number | null;
  poolIndex: number | null;
}

export interface PublicMatch {
  id: number;
  key: string;
  stage: MatchStage;
  /** 1-based. */
  round: number;
  /** 0-based na rodada. */
  position: number;
  groupIndex: number | null;
  slotAId: number | null;
  slotBId: number | null;
  nextMatchId: number | null;
  nextSlot: Slot | null;
  isBye: boolean;
  status: MatchStatus;
  winnerId: number | null;
  scoreA: number | null;
  scoreB: number | null;
  resultType: ResultType | null;
  /** Tatame (string no snapshot público). */
  mat: string | null;
  queueOrder: number | null;
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

export interface PublicCategory {
  id: number;
  name: string;
  format: TournamentFormat;
  status: CategoryStatus;
  thirdPlace: boolean;
  competitors: PublicCompetitor[];
  matches: PublicMatch[];
  standings: StandingsGroup[];
  podium: PodiumEntry[];
}

export interface PublicSnapshot {
  revision: number;
  serverTime: string;
  event: PublicEvent;
  organizationName: string;
  categories: PublicCategory[];
}

/** Chaves EXATAS de cada objeto do snapshot (mesma lista do backend: PUBLIC_SNAPSHOT_KEYS). */
export const SNAPSHOT_KEYS = {
  top: ["revision", "serverTime", "event", "organizationName", "categories"],
  event: ["title", "date", "location", "imageUrl"],
  category: ["id", "name", "format", "status", "thirdPlace", "competitors", "matches", "standings", "podium"],
  competitor: ["id", "name", "group", "graduation", "photoUrl", "seed", "poolIndex"],
  match: [
    "id", "key", "stage", "round", "position", "groupIndex", "slotAId", "slotBId", "nextMatchId", "nextSlot", "isBye",
    "status", "winnerId", "scoreA", "scoreB", "resultType", "mat", "queueOrder",
  ],
  standingsGroup: ["groupIndex", "rows"],
  standingRow: ["competitorId", "played", "wins", "draws", "losses", "pointsFor", "pointsAgainst", "points", "rank"],
  podium: ["place", "competitorId"],
} as const;

/** Campos que NUNCA podem aparecer no que o telão recebe (contrato, seção 5). */
export const FORBIDDEN_PUBLIC_KEYS = [
  "studentId",
  "eventParticipantId",
  "ageGroup",
  "photoAuthorized",
  "photoAuthorizedById",
  "photoAuthorizedAt",
  "birthDate",
  "note",
  "organizationId",
  "publicToken",
] as const;
