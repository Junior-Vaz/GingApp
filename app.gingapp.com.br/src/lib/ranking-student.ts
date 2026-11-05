import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dayOnly, fmt, isSameDay, startOfToday, toDate } from "@/lib/format";
import { useStudentScope, withQuery } from "@/lib/queries";
import { ALL_TIME } from "@/lib/ranking";

/**
 * Ginga Rank - lado do ALUNO: regras ("Como funciona"), extrato, evolução, meta do mês, conquistas e check-in diário.
 * Contrato único: docs/CONTRATO_RANK_ALUNO.md (o contrato vence qualquer dúvida). Tudo que é de um aluno segue o ALUNO ATIVO
 * (`useStudentScope`): `?studentId=` vai em toda consulta, como em /ranking/me. Sem aluno ligado nada é consultado.
 * Todas as chaves ficam sob ["ranking", ...]: o invalidador genérico do ranking (salvar configurações, check-in por GPS) também as cobre.
 */

/* ---------- Tipos do contrato ---------- */

export interface RankingRules {
  points: {
    classAttendance: number;
    streakStep: number;
    streakMax: number;
    eventAttendance: number;
    rodaParticipation: number;
    monthlyConsistency: number;
    graduationPerLevel: number;
    certificate: number;
    dailyCheckin: number;
    dailyWeekBonus: number;
  };
  limits: {
    maxClassPointsPerDay: number;
    /** 0..1 (ex.: 0.8). */
    consistencyMinRate: number;
    consistencyMinLessons: number;
    dailyWeekTarget: number;
    dailyMonthCapDays: number;
  };
  leagues: { code: string; name: string; color: string; minPoints: number }[];
  categories: { code: "GENERAL" | "TRAINING" | "RODAS" | "EVENTS"; label: string; description: string }[];
  bands: { code: "KIDS" | "YOUTH" | "ADULT"; label: string }[];
  achievements: { code: string; name: string; description: string; family: string; tier: AchievementTier | null }[];
  seasons: { lengthLabel: string; timezone: string };
}

export type AchievementTier = "BRONZE" | "SILVER" | "GOLD";

export type PointType =
  | "CLASS_ATTENDANCE"
  | "STREAK_BONUS"
  | "EVENT_ATTENDANCE"
  | "RODA_PARTICIPATION"
  | "MONTHLY_CONSISTENCY"
  | "GRADUATION"
  | "CERTIFICATE"
  | "DAILY_CHECKIN"
  | "DAILY_WEEK_BONUS";

export interface PointStatementItem {
  id: number;
  type: PointType;
  points: number;
  occurredAt: string;
  season: string;
  label: string;
}

export interface PointStatement {
  items: PointStatementItem[];
  total: number;
  seasonTotals: { season: string; points: number }[];
  allTimePoints: number;
}

export type Granularity = "WEEK" | "MONTH";

export interface EvolutionPoint {
  key: string;
  points: number;
  cumulative: number;
  lessons: number;
}

export interface Evolution {
  granularity: Granularity;
  points: EvolutionPoint[];
  bestWeek: { key: string; points: number } | null;
  currentStreakWeeks: number;
  bestStreakWeeks: number;
}

export interface GoalLeague {
  code: string;
  name: string;
  color: string;
}

export interface MonthGoal {
  season: string;
  lessonsPlanned: number;
  lessonsDone: number;
  present: number;
  neededForBonus: number;
  remainingForBonus: number;
  canStillReach: boolean;
  bonusPoints: number;
  hasGoal: boolean;
  league: {
    current: GoalLeague;
    next: (GoalLeague & { minPoints: number }) | null;
    pointsToNext: number;
    progressPct: number;
  };
}

export interface AchievementView {
  code: string;
  name: string;
  description: string;
  family: string;
  tier: AchievementTier | null;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
  progress: { current: number; target: number } | null;
  rarityPct: number | null;
}

export interface AchievementsResponse {
  items: AchievementView[];
  showcase: string[];
  earnedCount: number;
  totalCount: number;
}

export interface DailyCheckinStatus {
  today: string;
  checkedInToday: boolean;
  weekDays: number;
  weekTarget: number;
  weekDone: boolean;
  monthDays: number;
  monthCapDays: number;
  last7: { day: string; done: boolean }[];
}

export interface DailyCheckinResult extends DailyCheckinStatus {
  alreadyCheckedIn: boolean;
  pointsToday: number;
}

/** Máximo de conquistas na vitrine (contrato §3). */
export const SHOWCASE_MAX = 3;
/** Itens por página do extrato (contrato: 1..50, padrão 20). */
export const STATEMENT_PAGE = 20;
/** Barras do gráfico de evolução (contrato: 4..26, padrão 12). */
export const EVOLUTION_COUNT = 12;

/* ---------- Chaves e consultas ---------- */

const studentKeyOf = (studentId: number | undefined): number | null => studentId ?? null;

export const rankingKeys = {
  rules: ["ranking", "rules"] as const,
  points: (season: string, studentId: number | null) => ["ranking", "points", season, studentId] as const,
  evolution: (granularity: Granularity, studentId: number | null) => ["ranking", "evolution", granularity, EVOLUTION_COUNT, studentId] as const,
  goal: (studentId: number | null) => ["ranking", "goal", studentId] as const,
  achievements: (studentId: number | null) => ["ranking", "achievements", studentId] as const,
  daily: (studentId: number | null) => ["ranking", "daily-checkin", studentId] as const,
};

/** Consulta do aluno ativo: só dispara com /students/me resolvido E um aluno ligado (sem aluno = nenhuma requisição). */
function useScope() {
  const scope = useStudentScope();
  return { scope, studentId: scope.studentId, key: studentKeyOf(scope.studentId), enabled: scope.ready && scope.studentId !== undefined };
}

/** Enquanto o aluno ativo não é conhecido, conta como "carregando"; erro de /students/me vira erro da tela. */
function withScope<T extends { isLoading: boolean; error: Error | null }>(result: T, scope: { loading: boolean; error: Error | null }) {
  return {
    ...result,
    isLoading: result.isLoading || scope.loading,
    isError: result.error !== null || scope.error !== null,
    error: result.error ?? scope.error,
  };
}

/** Regras e textos do "Como funciona": são as constantes REAIS do servidor (mudam raramente; sem dado pessoal). */
export function useRankingRules(enabled = true) {
  return useQuery({
    queryKey: rankingKeys.rules,
    queryFn: () => api.get<RankingRules>("/ranking/rules"),
    enabled,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
}

/** Extrato paginado ("Ver mais") de uma temporada (`YYYY-MM`) ou de todas (`ALL`). */
export function useRankingStatement(season: string) {
  const { scope, studentId, key, enabled } = useScope();
  const query = useInfiniteQuery({
    queryKey: rankingKeys.points(season, key),
    enabled,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) =>
      api.get<PointStatement>(withQuery("/ranking/me/points", { season, limit: STATEMENT_PAGE, offset: pageParam, studentId })),
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
    seasonTotals: last?.seasonTotals ?? [],
    allTimePoints: last?.allTimePoints ?? 0,
    isLoading: query.isLoading || scope.loading,
    isError: query.isError || scope.error !== null,
    error: query.error ?? scope.error,
    isPlaceholderData: query.isPlaceholderData,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}

export function useRankingEvolution(granularity: Granularity) {
  const { scope, studentId, key, enabled } = useScope();
  const query = useQuery({
    queryKey: rankingKeys.evolution(granularity, key),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api.get<Evolution>(withQuery("/ranking/me/evolution", { granularity, count: EVOLUTION_COUNT, studentId })),
  });
  return withScope(query, scope);
}

export function useRankingGoal() {
  const { scope, studentId, key, enabled } = useScope();
  const query = useQuery({
    queryKey: rankingKeys.goal(key),
    enabled,
    queryFn: () => api.get<MonthGoal>(withQuery("/ranking/me/goal", { studentId })),
  });
  return withScope(query, scope);
}

export function useRankingAchievements() {
  const { scope, studentId, key, enabled } = useScope();
  const query = useQuery({
    queryKey: rankingKeys.achievements(key),
    enabled,
    queryFn: () => api.get<AchievementsResponse>(withQuery("/ranking/me/achievements", { studentId })),
  });
  return withScope(query, scope);
}

/** Estado do check-in diário. `enabled` extra deixa a Home calar a consulta; sem aluno ligado também não consulta. */
export function useDailyCheckinStatus(enabled = true) {
  const { scope, studentId, key, enabled: hasStudent } = useScope();
  const query = useQuery({
    queryKey: rankingKeys.daily(key),
    enabled: enabled && hasStudent,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const status = await api.get<DailyCheckinStatus>(withQuery("/ranking/me/daily-checkin", { studentId }));
      if (!isDailyStatus(status)) throw new Error("Resposta inesperada do check-in diário.");
      return status;
    },
  });
  return withScope(query, scope);
}

/** Confere o formato mínimo do contrato (§6) antes de a tela confiar nele: resposta fora do formato vira erro, nunca "undefined de undefined". */
export function isDailyStatus(value: unknown): value is DailyCheckinStatus {
  const status = value as Partial<DailyCheckinStatus> | null | undefined;
  return (
    typeof status === "object" &&
    status !== null &&
    typeof status.checkedInToday === "boolean" &&
    typeof status.weekDays === "number" &&
    typeof status.weekTarget === "number" &&
    Array.isArray(status.last7)
  );
}

/** Depois de gravar algo que muda pontos: o que o rank do aluno mostra é refeito (a Classificação refaz ao montar). */
const RANK_DERIVED_KEYS = [["ranking", "me"], ["ranking", "points"], ["ranking", "goal"], ["ranking", "evolution"], ["ranking", "achievements"]] as const;

/** O servidor recalcula os pontos em segundo plano logo após o POST: uma segunda leitura pega o que a primeira ainda não viu. */
const SECOND_REFRESH_MS = 3000;

/** POST /ranking/me/daily-checkin (sem corpo). Atualiza o estado do dia na hora e refaz as consultas do rank. */
export function useDailyCheckinMutation() {
  const { studentId, key } = useScope();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DailyCheckinResult>(withQuery("/ranking/me/daily-checkin", { studentId })),
    onSuccess: (result) => {
      if (isDailyStatus(result)) {
        const status: DailyCheckinStatus = {
          today: result.today,
          checkedInToday: result.checkedInToday,
          weekDays: result.weekDays,
          weekTarget: result.weekTarget,
          weekDone: result.weekDone,
          monthDays: result.monthDays,
          monthCapDays: result.monthCapDays,
          last7: result.last7,
        };
        queryClient.setQueryData<DailyCheckinStatus>(rankingKeys.daily(key), status);
      } else {
        void queryClient.invalidateQueries({ queryKey: rankingKeys.daily(key) });
      }
      const refresh = () => RANK_DERIVED_KEYS.forEach((queryKey) => void queryClient.invalidateQueries({ queryKey: [...queryKey] }));
      refresh();
      if (typeof window !== "undefined") window.setTimeout(refresh, SECOND_REFRESH_MS);
    },
  });
}

/* ---------- Regras puras (testáveis sem tela) ---------- */

export type GoalState = "none" | "reached" | "onTrack" | "unreachable";

export interface GoalView {
  state: GoalState;
  /** 0..1 do anel (presenças ÷ aulas planejadas do mês). */
  ratio: number;
  /** 0..1 da posição da marca "aqui vale o bônus" no anel (presenças necessárias ÷ aulas planejadas). */
  markRatio: number;
}

/** Estado da meta do mês: sem aulas planejadas = "none"; bônus garantido = "reached"; sem como alcançar = "unreachable" (mensagem gentil). */
export function goalView(goal: MonthGoal): GoalView {
  if (!goal.hasGoal || goal.lessonsPlanned <= 0) return { state: "none", ratio: 0, markRatio: 0 };
  const ratio = Math.max(0, Math.min(1, goal.present / goal.lessonsPlanned));
  const markRatio = Math.max(0, Math.min(1, goal.neededForBonus / goal.lessonsPlanned));
  const state: GoalState = goal.remainingForBonus <= 0 ? "reached" : goal.canStillReach ? "onTrack" : "unreachable";
  return { state, ratio, markRatio };
}

export interface ChartBar {
  key: string;
  points: number;
  /** Altura em px dentro da área do gráfico (mínimo de 3 px para a barra zerada continuar visível como "chão"). */
  height: number;
  x: number;
  width: number;
  isLast: boolean;
  label: string;
  /** Mostra o rótulo desta barra (alterna para não encavalar quando há muitas). */
  showLabel: boolean;
}

/** Rótulo curto: semana = `dd/MM` (segunda-feira); mês = `jan`, `fev`... */
export function evolutionLabel(key: string, granularity: Granularity): string {
  if (granularity === "WEEK") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    return match ? `${match[3]}/${match[2]}` : key;
  }
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return fmt(new Date(Number(match[1]), Number(match[2]) - 1, 1), "MMM").replace(/\.$/, "");
}

/** Rótulo por extenso para leitor de tela / tabela: "semana de 27/10" ou "outubro de 2026". */
export function evolutionLongLabel(key: string, granularity: Granularity): string {
  return granularity === "WEEK" ? `semana de ${evolutionLabel(key, "WEEK")}` : monthLong(key);
}

function monthLong(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  return match ? fmt(new Date(Number(match[1]), Number(match[2]) - 1, 1), "MMMM 'de' yyyy") : key;
}

/** Geometria das barras (SVG simples, sem biblioteca): escala pelo maior valor; a última barra é a "atual". */
export function chartBars(points: EvolutionPoint[], granularity: Granularity, area: { width: number; height: number; gap?: number }): ChartBar[] {
  const count = points.length;
  if (count === 0) return [];
  const gap = area.gap ?? 6;
  const width = Math.max(4, (area.width - gap * (count - 1)) / count);
  const max = Math.max(1, ...points.map((p) => p.points));
  const labelEvery = count > 14 ? 3 : count > 8 ? 2 : 1;
  return points.map((point, index) => {
    const isLast = index === count - 1;
    const scaled = point.points > 0 ? Math.max(4, (point.points / max) * area.height) : 3;
    return {
      key: point.key,
      points: point.points,
      height: scaled,
      x: index * (width + gap),
      width,
      isLast,
      label: evolutionLabel(point.key, granularity),
      // sempre rotula a última; as demais alternam e pulam a vizinha da última para não encavalar.
      showLabel: isLast || ((count - 1 - index) % labelEvery === 0 && count - 1 - index >= labelEvery),
    };
  });
}

/** "4%" / "4,5%" (1 casa só quando precisa). */
export function formatPercent(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Texto da raridade ("só 4% do grupo tem"); null = não mostrar (grupo pequeno). */
export function rarityText(rarityPct: number | null): string | null {
  if (rarityPct === null || rarityPct === undefined || !Number.isFinite(rarityPct)) return null;
  return rarityPct < 50 ? `só ${formatPercent(rarityPct)} do grupo tem` : `${formatPercent(rarityPct)} do grupo tem`;
}

/** Instante do extrato: meia-noite UTC é "só dia" (mesmo dia civil local); um instante real usa o relógio local. */
export function statementDay(iso: string): Date {
  return /T00:00:00(\.0+)?Z$/.test(iso) ? dayOnly(iso) : toDate(iso);
}

/** "Hoje", "Ontem" ou data curta (`dd/MM`; com ano se não for o corrente). */
export function statementDateLabel(iso: string, now: Date = new Date()): string {
  const day = statementDay(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (isSameDay(day, today)) return "Hoje";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(day, yesterday)) return "Ontem";
  return fmt(day, day.getFullYear() === today.getFullYear() ? "dd/MM" : "dd/MM/yy");
}

/** Dia completo para o `title`/leitor de tela. */
export const statementFullDate = (iso: string): string => fmt(statementDay(iso), "dd/MM/yyyy");

/** Dia da semana curto (inicial) a partir de 'YYYY-MM-DD' (servidor, SP): data civil sem fuso. */
export function civilDay(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : startOfToday();
}

/** Opções do filtro de temporada do extrato: Todas + as temporadas do aluno (já em ordem decrescente). */
export function statementSeasonOptions(seasonTotals: { season: string; points: number }[]): string[] {
  return [ALL_TIME, ...seasonTotals.map((item) => item.season).filter((season) => season !== ALL_TIME)];
}

export interface StreakStep {
  week: number;
  bonus: number;
}

/**
 * Exemplo da sequência semanal, CALCULADO das constantes do servidor: `streakStep` por semana seguida a partir da 2ª, até `streakMax`.
 * Devolve as primeiras semanas até o teto (no máximo 6 linhas) e a semana em que o teto é atingido.
 */
export function streakExample(rules: Pick<RankingRules["points"], "streakStep" | "streakMax">): { steps: StreakStep[]; capWeek: number } {
  const streakStep = rules.streakStep > 0 ? rules.streakStep : 1;
  const streakMax = rules.streakMax;
  const capWeek = Math.ceil(streakMax / streakStep) + 1;
  const steps: StreakStep[] = [];
  for (let week = 2; week <= Math.min(capWeek, 7); week += 1) {
    steps.push({ week, bonus: Math.min(streakMax, streakStep * (week - 1)) });
  }
  return { steps, capWeek };
}
