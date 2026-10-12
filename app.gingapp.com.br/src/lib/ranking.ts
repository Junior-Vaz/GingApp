import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { capitalize, fmt } from "@/lib/format";
import { useStudentScope, withQuery } from "@/lib/queries";

/**
 * Ginga Rank - contrato com o backend (GET /ranking/students, /ranking/groups, /ranking/me,
 * PUT /ranking/me/settings, GET /ranking/seasons) e regras puras (ligas, temporadas, cores).
 * Tudo que depende de um aluno segue o ALUNO ATIVO (`useStudentScope`), como as demais telas.
 */

export type RankScope = "GROUP" | "CITY" | "STATE" | "COUNTRY";
export type GroupScope = Exclude<RankScope, "GROUP">;
export type RankCategory = "GENERAL" | "TRAINING" | "RODAS" | "EVENTS";
export type RankBand = "KIDS" | "YOUTH" | "ADULT";
/** `YYYY-MM` ou `ALL` (todos os tempos). */
export type Season = string;
export const ALL_TIME = "ALL";

export interface RankLevel {
  code: string;
  name: string;
  color: string;
}

export interface StudentRankItem {
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
  level: RankLevel;
  /** > 0 subiu N posicoes, < 0 desceu N, 0 igual, null = sem comparacao (novo no ranking). */
  rankDelta: number | null;
  isMe: boolean;
}

export interface StudentsRankingPage {
  items: StudentRankItem[];
  me: { rank: number | null; points: number; inList: boolean } | null;
  total: number;
  season: string;
  scope: RankScope;
  category: RankCategory;
  band: RankBand | null;
}

export interface GroupRankItem {
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
  items: GroupRankItem[];
  total: number;
  season: string;
  scope: GroupScope;
}

export interface RankAchievement {
  code: string;
  name: string;
  description: string;
  earnedAt: string;
}

export interface RankSettings {
  optInPublic: boolean;
  nickname: string | null;
  canOptIn: boolean;
  requiresGuardianConsent: boolean;
}

export interface NextLevel extends RankLevel {
  minPoints: number;
}

export interface RankingMe {
  student: { id: number; displayName: string; avatarUrl: string | null };
  points: { season: number; allTime: number };
  level: RankLevel;
  nextLevel: NextLevel | null;
  pointsToNext: number | null;
  progressPct: number;
  streakWeeks: number;
  rank: { group: number | null; city: number | null; state: number | null; country: number | null };
  achievements: RankAchievement[];
  availableAchievements: { code: string; name: string; description: string }[];
  settings: RankSettings;
}

export interface SeasonsResponse {
  current: string;
  items: {
    season: string;
    champions: {
      country: { studentId: number; displayName: string; points: number } | null;
      group: { studentId: number; displayName: string; points: number } | null;
    };
  }[];
}

/* ---------- Ligas ---------- */

export const LEAGUES: readonly RankLevel[] = [
  { code: "CRUA", name: "Crua", color: "#E5E5E5" },
  { code: "VERDE", name: "Verde", color: "#22C55E" },
  { code: "AMARELA", name: "Amarela", color: "#FACC15" },
  { code: "AZUL", name: "Azul", color: "#3B82F6" },
  { code: "ROXA", name: "Roxa", color: "#8B5CF6" },
  { code: "MARROM", name: "Marrom", color: "#92400E" },
  { code: "PRETA", name: "Preta", color: "#111827" },
];

export const leagueIndex = (code: string | null | undefined): number => LEAGUES.findIndex((l) => l.code === code);

/** Cor da liga: a que o servidor mandou, ou a da tabela local (por codigo), ou um cinza neutro. */
export function leagueColor(level: Pick<RankLevel, "code" | "color"> | null | undefined): string {
  if (!level) return "#E5E5E5";
  return (level.color && /^#[0-9a-f]{3,8}$/i.test(level.color) ? level.color : LEAGUES.find((l) => l.code === level.code)?.color) ?? "#E5E5E5";
}

/** Texto legivel (preto/branco) sobre um fundo hexadecimal. */
export function readableOn(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return "#111827";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "#111827" : "#ffffff";
}

/* ---------- Filtros e rotulos ---------- */

export const SCOPES: { value: RankScope; label: string }[] = [
  { value: "GROUP", label: "Meu grupo" },
  { value: "CITY", label: "Cidade" },
  { value: "STATE", label: "Estado" },
  { value: "COUNTRY", label: "Brasil" },
];

export const CATEGORIES: { value: RankCategory; label: string }[] = [
  { value: "GENERAL", label: "Geral" },
  { value: "TRAINING", label: "Treino" },
  { value: "RODAS", label: "Rodas" },
  { value: "EVENTS", label: "Eventos" },
];

export const BANDS: { value: RankBand | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "KIDS", label: "Kids" },
  { value: "YOUTH", label: "Juvenil" },
  { value: "ADULT", label: "Adulto" },
];

/** Mes atual (dia civil local) no formato do servidor. */
export const currentSeasonLocal = (now: Date = new Date()): string => fmt(now, "yyyy-MM");

export function seasonLabel(season: string): string {
  if (season === ALL_TIME) return "Todos os tempos";
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) return season;
  return capitalize(fmt(new Date(Number(match[1]), Number(match[2]) - 1, 1), "MMMM 'de' yyyy"));
}

export const formatPoints = (points: number): string => points.toLocaleString("pt-BR");

/* ---------- Consultas ---------- */

export const PAGE = 50;

export interface StudentFilters {
  scope: RankScope;
  season: Season;
  category: RankCategory;
  band: RankBand | "";
}

export function useRankingSeasons() {
  return useQuery({
    queryKey: ["ranking", "seasons"],
    queryFn: () => api.get<SeasonsResponse>("/ranking/seasons"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useRankingStudents(filters: StudentFilters, enabled: boolean) {
  const student = useStudentScope();
  const query = useInfiniteQuery({
    queryKey: ["ranking", "students", filters, student.studentId ?? null],
    enabled: enabled && student.ready,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api.get<StudentsRankingPage>(
        withQuery("/ranking/students", {
          scope: filters.scope,
          season: filters.season,
          category: filters.category,
          band: filters.band,
          limit: PAGE,
          offset: pageParam,
          studentId: student.studentId,
        }),
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const last = pages[pages.length - 1];
  return {
    items: pages.flatMap((page) => page.items),
    // `me` da ULTIMA pagina carregada (o servidor recalcula "inList" por pagina); a posicao nao muda.
    me: last?.me ?? first?.me ?? null,
    total: last?.total ?? 0,
    meta: first ? { season: first.season, scope: first.scope, category: first.category, band: first.band } : null,
    isLoading: query.isLoading || (!student.ready && student.loading),
    isError: query.isError || student.error !== null,
    error: query.error ?? student.error,
    isPlaceholderData: query.isPlaceholderData,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export function useRankingGroups(filters: { scope: GroupScope; season: Season }, enabled: boolean) {
  // O contrato de /ranking/groups nao tem studentId (o grupo "meu" vem do token); a chave inclui o aluno
  // ativo so para o cache nao misturar "Meu grupo" entre dependentes de grupos diferentes.
  const student = useStudentScope();
  const query = useInfiniteQuery({
    queryKey: ["ranking", "groups", filters, student.studentId ?? null],
    enabled: enabled && student.ready,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api.get<GroupsRankingPage>(
        withQuery("/ranking/groups", { scope: filters.scope, season: filters.season, limit: PAGE, offset: pageParam }),
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
  const pages = query.data?.pages ?? [];
  const last = pages[pages.length - 1];
  return {
    items: pages.flatMap((page) => page.items),
    total: last?.total ?? 0,
    isLoading: query.isLoading || (!student.ready && student.loading),
    isError: query.isError || student.error !== null,
    error: query.error ?? student.error,
    isPlaceholderData: query.isPlaceholderData,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export function useRankingMe() {
  const student = useStudentScope();
  const query = useQuery({
    queryKey: ["ranking", "me", student.studentId ?? null],
    queryFn: () => api.get<RankingMe>(withQuery("/ranking/me", { studentId: student.studentId })),
    enabled: student.ready,
  });
  return { ...query, isLoading: query.isLoading || student.loading };
}

export interface SettingsInput {
  optInPublic?: boolean;
  nickname?: string | null;
}

/** Salva as preferencias do aluno ativo. 403 {code:'GUARDIAN_CONSENT_REQUIRED'} chega como ApiError (code). */
export function useSaveRankingSettings() {
  const student = useStudentScope();
  const queryClient = useQueryClient();
  const studentKey = student.studentId ?? null;
  return useMutation({
    mutationFn: (body: SettingsInput) =>
      api.put<RankSettings>(withQuery("/ranking/me/settings", { studentId: student.studentId }), body),
    onSuccess: (settings) => {
      if (settings && typeof settings === "object") {
        queryClient.setQueryData<RankingMe>(["ranking", "me", studentKey], (old) => (old ? { ...old, settings } : old));
      }
      void queryClient.invalidateQueries({ queryKey: ["ranking"] });
    },
  });
}

/* ---------- Subida de liga (confete) ---------- */

const LEAGUE_KEY = (studentId: number | null | undefined) => `gingapp:ranking:league:${studentId ?? "me"}`;

export function readSeenLeague(studentId: number | null | undefined): string | null {
  try {
    return localStorage.getItem(LEAGUE_KEY(studentId));
  } catch {
    return null;
  }
}

export function storeSeenLeague(studentId: number | null | undefined, code: string): void {
  try {
    localStorage.setItem(LEAGUE_KEY(studentId), code);
  } catch {
    /* sem armazenamento (modo privado): so nao comemora na proxima visita */
  }
}

/** true quando a liga atual e MAIOR que a ultima vista (sem registro anterior nao comemora). */
export function leveledUp(previous: string | null, current: string): boolean {
  if (!previous) return false;
  const before = leagueIndex(previous);
  const now = leagueIndex(current);
  return before >= 0 && now > before;
}

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
