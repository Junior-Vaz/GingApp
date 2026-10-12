import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, buildQuery, type QueryParams } from "@/lib/api";
import { fmt } from "@/lib/format";

/* ---------- Contratos (backend: RankingController, /ranking/*) ---------- */

export type RankingCategory = "GENERAL" | "TRAINING" | "RODAS" | "EVENTS";
export type RankingBand = "KIDS" | "YOUTH" | "ADULT";
export type GroupsScope = "CITY" | "STATE" | "COUNTRY";

export interface RankingLevel {
  /** CRUA, VERDE, AMARELA, AZUL, ROXA, MARROM ou PRETA. */
  code: string;
  name: string;
  color: string;
}

export interface RankingStudent {
  rank: number;
  studentId: number;
  displayName: string;
  avatarUrl: string | null;
  groupId: number;
  groupName: string;
  groupLogoUrl: string | null;
  city: string | null;
  state: string | null;
  points: number;
  level: RankingLevel;
  /** Posições ganhas desde a temporada anterior: positivo = subiu, negativo = caiu, null = sem comparação (novo). */
  rankDelta: number | null;
  isMe: boolean;
}

export interface RankingStudentsPage {
  items: RankingStudent[];
  me?: RankingStudent | null;
  total: number;
  season: string;
  scope: string;
  category: RankingCategory;
  band: RankingBand | null;
}

export interface GroupOverview {
  topStudents: RankingStudent[];
  /** Alunos sem pontos na temporada. */
  inactiveCount: number;
  totalPoints: number;
  avgPoints: number;
  activeStudents: number;
}

export interface SeasonChampion {
  studentId: number;
  displayName: string;
  points: number;
}

export interface SeasonSummary {
  season: string;
  champions: { country: SeasonChampion | null; group: SeasonChampion | null };
}

export interface SeasonsResponse {
  current: string;
  items: SeasonSummary[];
}

export interface RankingGroup {
  rank: number;
  groupId: number;
  name: string;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  studentsCount: number;
  totalPoints: number;
  avgPoints: number;
  isMine: boolean;
}

export interface GroupsRankingPage {
  items: RankingGroup[];
  total: number;
  season: string;
  scope: GroupsScope;
}

/* ---------- Rótulos e cores ---------- */

export const CATEGORY_LABEL: Record<RankingCategory, string> = {
  GENERAL: "Geral",
  TRAINING: "Treinos",
  RODAS: "Rodas",
  EVENTS: "Eventos",
};

export const BAND_LABEL: Record<RankingBand, string> = {
  KIDS: "Infantil",
  YOUTH: "Juvenil",
  ADULT: "Adulto",
};

export const SCOPE_LABEL: Record<GroupsScope, string> = {
  COUNTRY: "Brasil",
  STATE: "Meu estado",
  CITY: "Minha cidade",
};

/** Ligas (cores oficiais do ranking). A cor enviada pelo backend só vale para um código desconhecido. */
export const LEAGUE_COLORS: Record<string, string> = {
  CRUA: "#E5E5E5",
  VERDE: "#22C55E",
  AMARELA: "#FACC15",
  AZUL: "#3B82F6",
  ROXA: "#8B5CF6",
  MARROM: "#92400E",
  PRETA: "#111827",
};

const FALLBACK_COLOR = "#E5E5E5";

export const leagueColor = (level: Pick<RankingLevel, "code" | "color"> | null | undefined): string =>
  (level && (LEAGUE_COLORS[level.code] ?? (/^#[0-9a-f]{6}$/i.test(level.color) ? level.color : undefined))) || FALLBACK_COLOR;

/** Preto ou branco, o que contrasta mais com o fundo `hex` (#RRGGBB). */
export function readableTextColor(hex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : FALLBACK_COLOR.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#FFFFFF";
}

/** "2026-10" -> "outubro de 2026"; "ALL" -> "Geral (todas as temporadas)". */
export function seasonLabel(season: string): string {
  if (season === "ALL") return "Geral (todas as temporadas)";
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) return season;
  return fmt(new Date(Number(match[1]), Number(match[2]) - 1, 1), "MMMM 'de' yyyy");
}

export interface DeltaInfo {
  kind: "up" | "down" | "same" | "new";
  amount: number;
  label: string;
}

/** Variação de posição para exibição (seta) e leitores de tela. */
export function deltaInfo(delta: number | null | undefined): DeltaInfo {
  if (delta === null || delta === undefined) return { kind: "new", amount: 0, label: "Sem comparação com a temporada anterior" };
  if (delta > 0) return { kind: "up", amount: delta, label: `Subiu ${delta} ${delta === 1 ? "posição" : "posições"}` };
  if (delta < 0) return { kind: "down", amount: -delta, label: `Caiu ${-delta} ${delta === -1 ? "posição" : "posições"}` };
  return { kind: "same", amount: 0, label: "Manteve a posição" };
}

export const formatPoints = (points: number): string => points.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/* ---------- CSV (formato da lista) ---------- */

export const RANKING_CSV_HEADERS = ["Posição", "Aluno", "Liga", "Pontos", "Variação", "Grupo", "Cidade", "UF"] as const;

export function rankingCsvRows(items: readonly RankingStudent[]): (string | number)[][] {
  return items.map((s) => {
    const delta = deltaInfo(s.rankDelta);
    // Número (não texto "+2"): o CSV neutraliza texto que começa com + ou - (anti CSV injection).
    const variation: string | number = delta.kind === "new" ? "Novo" : delta.kind === "up" ? delta.amount : delta.kind === "down" ? -delta.amount : 0;
    return [s.rank, s.displayName, s.level.name, s.points, variation, s.groupName, s.city ?? "", s.state ?? ""];
  });
}

/* ---------- Queries ---------- */

export interface StudentsRankingParams {
  season: string;
  category: RankingCategory;
  band: RankingBand | "";
  limit: number;
  offset: number;
}

export function useStudentsRanking(p: StudentsRankingParams) {
  const params: QueryParams = {
    scope: "GROUP",
    season: p.season,
    category: p.category,
    band: p.band,
    limit: p.limit,
    offset: p.offset,
  };
  return useQuery({
    queryKey: ["ranking", "students", params],
    queryFn: () => api.get<RankingStudentsPage>(`/ranking/students${buildQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useGroupOverview() {
  return useQuery({
    queryKey: ["ranking", "group-overview"],
    queryFn: () => api.get<GroupOverview>("/ranking/group-overview"),
  });
}

export function useRankingSeasons() {
  return useQuery({
    queryKey: ["ranking", "seasons"],
    queryFn: () => api.get<SeasonsResponse>("/ranking/seasons"),
  });
}

export interface GroupsRankingParams {
  scope: GroupsScope;
  season: string;
  limit: number;
  offset: number;
}

export function useGroupsRanking(p: GroupsRankingParams, enabled = true) {
  const params: QueryParams = { scope: p.scope, season: p.season, limit: p.limit, offset: p.offset };
  return useQuery({
    queryKey: ["ranking", "groups", params],
    queryFn: () => api.get<GroupsRankingPage>(`/ranking/groups${buildQuery(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}
