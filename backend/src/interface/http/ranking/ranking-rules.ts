import { PointEventType } from '@prisma/client';

/**
 * Regras PURAS (sem banco) do Ginga Rank: SSOT de pontos, ligas, conquistas, temporadas e privacidade. Tudo que o
 * motor (RankingService) e as consultas (RankingQueryService) decidem passa por aqui, para ser testavel sem Postgres.
 *
 * Mensalidade/financeiro NUNCA entra. So conta presenca registrada pelo professor (Attendance.present) ou check-in
 * dentro da janela (que grava a mesma Attendance/EventParticipant ATTENDED).
 */

// ---------------------------------------------------------------------------------------------
// Pontos
// ---------------------------------------------------------------------------------------------

export const POINTS = {
  CLASS_ATTENDANCE: 10,
  /** +5 por semana consecutiva adicional (2a semana = 5, 3a = 10 ... ate o teto), uma bonificacao por semana. */
  STREAK_STEP: 5,
  STREAK_MAX: 25,
  EVENT_ATTENDANCE: 30,
  RODA_PARTICIPATION: 25,
  MONTHLY_CONSISTENCY: 50,
  /** GRADUATION = 100 x ordem do nivel da corda (minimo 1). */
  GRADUATION_PER_LEVEL: 100,
  CERTIFICATE: 20,
  /** Check-in diario do app (docs/CONTRATO_RANK_ALUNO.md secao 6): vale POUCO de proposito (o treino vale muito mais). */
  DAILY_CHECKIN: 1,
  /** Semana (segunda a domingo, SP) ENCERRADA com >= DAILY_WEEK_TARGET dias de check-in: uma vez por semana. */
  DAILY_WEEK_BONUS: 5,
} as const;

/** Anti-fraude: no maximo 1 CLASS_ATTENDANCE por aula (unique por refId) e 3 por dia civil. */
export const MAX_CLASS_POINTS_PER_DAY = 3;
/** MONTHLY_CONSISTENCY: frequencia minima do mes e numero minimo de aulas (com chamada) no mes. */
export const CONSISTENCY_MIN_RATE = 0.8;
export const CONSISTENCY_MIN_LESSONS = 4;
/** Check-in diario: dias na semana para o bonus "semana em dia". */
export const DAILY_WEEK_TARGET = 5;
/** Check-in diario: no maximo 20 dias pontuam por temporada (mes); os demais contam so para a semana e as conquistas. */
export const DAILY_MONTH_CAP_DAYS = 20;

export const CATEGORIES = ['GENERAL', 'TRAINING', 'RODAS', 'EVENTS'] as const;
export type RankingCategory = (typeof CATEGORIES)[number];

/** category -> tipos de ponto somados (GENERAL = todos = null; DAILY_* so entram no GENERAL). */
export function typesForCategory(category: RankingCategory): PointEventType[] | null {
  switch (category) {
    case 'TRAINING':
      return [PointEventType.CLASS_ATTENDANCE, PointEventType.STREAK_BONUS, PointEventType.MONTHLY_CONSISTENCY];
    case 'RODAS':
      return [PointEventType.RODA_PARTICIPATION];
    case 'EVENTS':
      return [PointEventType.EVENT_ATTENDANCE];
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Ligas
// ---------------------------------------------------------------------------------------------

export interface League {
  code: string;
  name: string;
  color: string;
  minPoints: number;
}

/** Pelos pontos acumulados de todos os tempos. */
export const LEAGUES: readonly League[] = [
  { code: 'CRUA', name: 'Semente', color: '#E5E5E5', minPoints: 0 },
  { code: 'VERDE', name: 'Broto', color: '#22C55E', minPoints: 300 },
  { code: 'AMARELA', name: 'Ginga', color: '#FACC15', minPoints: 900 },
  { code: 'AZUL', name: 'Roda', color: '#3B82F6', minPoints: 2000 },
  { code: 'ROXA', name: 'Axé', color: '#8B5CF6', minPoints: 4000 },
  { code: 'MARROM', name: 'Mandinga', color: '#92400E', minPoints: 7500 },
  { code: 'PRETA', name: 'Lenda', color: '#111827', minPoints: 12000 },
];

export function leagueIndexFor(allTimePoints: number): number {
  let index = 0;
  LEAGUES.forEach((league, i) => {
    if (allTimePoints >= league.minPoints) index = i;
  });
  return index;
}

export function leagueFor(allTimePoints: number): League {
  return LEAGUES[leagueIndexFor(allTimePoints)];
}

export function nextLeagueFor(allTimePoints: number): League | null {
  return LEAGUES[leagueIndexFor(allTimePoints) + 1] ?? null;
}

export const levelView = (l: League): { code: string; name: string; color: string } => ({
  code: l.code,
  name: l.name,
  color: l.color,
});

/** 0..100 do caminho entre a liga atual e a proxima (100 na ultima liga). */
export function progressPct(allTimePoints: number): number {
  const current = leagueFor(allTimePoints);
  const next = nextLeagueFor(allTimePoints);
  if (!next) return 100;
  const span = next.minPoints - current.minPoints;
  return Math.max(0, Math.min(100, Math.floor(((allTimePoints - current.minPoints) / span) * 100)));
}

/** Marcador interno (Achievement) de "liga ja notificada". Nao e' uma conquista exibida. */
export const LEAGUE_MARKER_PREFIX = 'LEAGUE_';
export const leagueMarker = (league: League): string => `${LEAGUE_MARKER_PREFIX}${league.code}`;

// ---------------------------------------------------------------------------------------------
// Conquistas
// ---------------------------------------------------------------------------------------------

export type AchievementTier = 'BRONZE' | 'SILVER' | 'GOLD';
export const TIERS: readonly AchievementTier[] = ['BRONZE', 'SILVER', 'GOLD'];

/** Familias na ordem de exibicao; `icon` = chave curta estavel (o app mapeia para um icone lucide). */
export const ACHIEVEMENT_FAMILIES = [
  { family: 'PRESENCA', icon: 'presenca' },
  { family: 'SEQUENCIA', icon: 'sequencia' },
  { family: 'MES', icon: 'mes' },
  { family: 'RODAS', icon: 'rodas' },
  { family: 'EVENTOS', icon: 'eventos' },
  { family: 'JORNADA', icon: 'jornada' },
  { family: 'TEMPO', icon: 'tempo' },
  { family: 'DIARIO', icon: 'diario' },
] as const;
export type AchievementFamily = (typeof ACHIEVEMENT_FAMILIES)[number]['family'];

/**
 * Contadores da derivacao (UMA fonte so): o progresso `current/target` das conquistas e o que a propria derivePoints
 * contou para concede-las. Nada de recontar a parte.
 */
export interface DerivationCounters {
  /** Aulas presentes CONTADAS (as que pontuaram: anti-fraude de 3 por dia ja aplicado). */
  lessons: number;
  /** Maior numero de semanas consecutivas com presenca contada. */
  bestStreakWeeks: number;
  /** Maior numero de meses seguidos com bonus de consistencia. */
  bestConsistentMonths: number;
  rodas: number;
  events: number;
  graduations: number;
  certificates: number;
  /** Meses completos desde a primeira data conhecida do aluno no grupo (matricula/primeira presenca); 0 sem data. */
  monthsInGroup: number;
  /** Dias com check-in diario (todos, inclusive os que passaram do teto mensal de pontos). */
  dailyCheckins: number;
  /** Maior numero de semanas ENCERRADAS seguidas "em dia" (>= DAILY_WEEK_TARGET check-ins). */
  bestDailyWeekRun: number;
}

export interface AchievementDef {
  code: string;
  name: string;
  description: string;
  family: AchievementFamily;
  tier: AchievementTier | null;
  /** Meta contavel (null = nao contavel: Mes perfeito, Voltei). */
  target: number | null;
  /** Contador da derivacao que mede o progresso (null quando `target` e' null). */
  counter: keyof DerivationCounters | null;
}

const ach = (
  code: string,
  family: AchievementFamily,
  tier: AchievementTier,
  name: string,
  description: string,
  counter: keyof DerivationCounters | null = null,
  target: number | null = null,
): AchievementDef => ({ code, name, description, family, tier, target, counter });

/**
 * Catalogo (docs/CONTRATO_RANK_ALUNO.md secao 2). Os 6 codigos originais (SEQ_4W, FIRST_GRADUATION, RODA_10, EVENT_5,
 * PERFECT_MONTH, CENTURION) mantem codigo, nome, descricao e regra. Ordem = familia, depois nivel.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // PRESENCA: aulas presentes CONTADAS
  ach('AULAS_25', 'PRESENCA', 'BRONZE', 'Pé no treino', 'Chegou a 25 aulas presentes.', 'lessons', 25),
  ach('CENTURION', 'PRESENCA', 'SILVER', 'Centurião', 'Chegou a 100 aulas presentes.', 'lessons', 100),
  ach('AULAS_250', 'PRESENCA', 'GOLD', 'Veterano dos treinos', 'Chegou a 250 aulas presentes.', 'lessons', 250),
  ach('AULAS_500', 'PRESENCA', 'GOLD', 'Incansável', 'Chegou a 500 aulas presentes.', 'lessons', 500),
  ach('AULAS_1000', 'PRESENCA', 'GOLD', 'Mil aulas', 'Chegou a 1000 aulas presentes.', 'lessons', 1000),
  // SEQUENCIA: semanas consecutivas com presenca
  ach('SEQ_4W', 'SEQUENCIA', 'BRONZE', 'Sequência de 4 semanas', 'Treinou 4 semanas seguidas.', 'bestStreakWeeks', 4),
  ach('SEQ_8W', 'SEQUENCIA', 'SILVER', 'Sequência de 8 semanas', 'Treinou 8 semanas seguidas.', 'bestStreakWeeks', 8),
  ach('SEQ_12W', 'SEQUENCIA', 'GOLD', 'Sequência de 12 semanas', 'Treinou 12 semanas seguidas.', 'bestStreakWeeks', 12),
  ach('SEQ_26W', 'SEQUENCIA', 'GOLD', 'Meio ano sem parar', 'Treinou 26 semanas seguidas.', 'bestStreakWeeks', 26),
  ach('SEQ_52W', 'SEQUENCIA', 'GOLD', 'Um ano sem parar', 'Treinou 52 semanas seguidas.', 'bestStreakWeeks', 52),
  // MES
  ach('CONSISTENT_3M', 'MES', 'SILVER', 'Trimestre consistente', 'Ganhou o bônus de mês consistente 3 meses seguidos.', 'bestConsistentMonths', 3),
  ach('PERFECT_MONTH', 'MES', 'GOLD', 'Mês perfeito', '100% de presença em um mês (mínimo de 4 aulas).'),
  ach('CONSISTENT_6M', 'MES', 'GOLD', 'Semestre consistente', 'Ganhou o bônus de mês consistente 6 meses seguidos.', 'bestConsistentMonths', 6),
  // RODAS
  ach('RODA_1', 'RODAS', 'BRONZE', 'Primeira roda', 'Participou da primeira roda.', 'rodas', 1),
  ach('RODA_10', 'RODAS', 'SILVER', 'Rodeiro', 'Participou de 10 rodas.', 'rodas', 10),
  ach('RODA_25', 'RODAS', 'GOLD', 'Roda é vida', 'Participou de 25 rodas.', 'rodas', 25),
  ach('RODA_50', 'RODAS', 'GOLD', 'Cinquenta rodas', 'Participou de 50 rodas.', 'rodas', 50),
  // EVENTOS
  ach('EVENT_1', 'EVENTOS', 'BRONZE', 'Primeiro evento', 'Esteve no primeiro evento do grupo.', 'events', 1),
  ach('EVENT_5', 'EVENTOS', 'SILVER', 'Presença em eventos', 'Esteve em 5 eventos do grupo.', 'events', 5),
  ach('EVENT_15', 'EVENTOS', 'GOLD', 'Figura carimbada', 'Esteve em 15 eventos do grupo.', 'events', 15),
  ach('EVENT_30', 'EVENTOS', 'GOLD', 'Sempre presente', 'Esteve em 30 eventos do grupo.', 'events', 30),
  // JORNADA
  ach('FIRST_GRADUATION', 'JORNADA', 'BRONZE', 'Primeira corda', 'Recebeu a primeira graduação.', 'graduations', 1),
  ach('GRADUATIONS_3', 'JORNADA', 'SILVER', 'Três cordas', 'Recebeu 3 graduações.', 'graduations', 3),
  ach('CERTIFICATES_3', 'JORNADA', 'SILVER', 'Colecionador de certificados', 'Recebeu 3 certificados.', 'certificates', 3),
  ach('GRADUATIONS_5', 'JORNADA', 'GOLD', 'Cinco cordas', 'Recebeu 5 graduações.', 'graduations', 5),
  // TEMPO: desde a primeira data conhecida do aluno no grupo (meses completos)
  ach('YEARS_1', 'TEMPO', 'BRONZE', 'Um ano de capoeira', 'Completou 1 ano no grupo.', 'monthsInGroup', 12),
  ach('YEARS_2', 'TEMPO', 'SILVER', 'Dois anos de capoeira', 'Completou 2 anos no grupo.', 'monthsInGroup', 24),
  ach('COMEBACK', 'TEMPO', 'SILVER', 'Voltei!', 'Voltou a treinar depois de 30 dias ou mais sem aula.'),
  ach('YEARS_5', 'TEMPO', 'GOLD', 'Cinco anos de capoeira', 'Completou 5 anos no grupo.', 'monthsInGroup', 60),
  // DIARIO: check-in diario do app
  ach('DAILY_7', 'DIARIO', 'BRONZE', 'Salve! 7 dias', 'Fez 7 check-ins diários no app.', 'dailyCheckins', 7),
  ach('DAILY_30', 'DIARIO', 'SILVER', 'Salve! 30 dias', 'Fez 30 check-ins diários no app.', 'dailyCheckins', 30),
  ach('WEEK_OK_4', 'DIARIO', 'SILVER', 'Um mês em dia', 'Completou 4 semanas em dia seguidas no check-in diário.', 'bestDailyWeekRun', 4),
  ach('DAILY_100', 'DIARIO', 'GOLD', 'Salve! 100 dias', 'Fez 100 check-ins diários no app.', 'dailyCheckins', 100),
];

/** Os 6 codigos originais: regra e notificacao de sempre (sem a janela de 7 dias das conquistas novas). */
export const LEGACY_ACHIEVEMENT_CODES: ReadonlySet<string> = new Set([
  'SEQ_4W',
  'FIRST_GRADUATION',
  'RODA_10',
  'EVENT_5',
  'PERFECT_MONTH',
  'CENTURION',
]);
/** Conquista NOVA concedida retroativamente so notifica se o requisito foi atingido nos ultimos 7 dias. */
export const ACHIEVEMENT_NOTIFY_WINDOW_DAYS = 7;

export function shouldNotifyAchievement(code: string, earnedAt: Date, now: Date): boolean {
  if (LEGACY_ACHIEVEMENT_CODES.has(code)) return true;
  return earnedAt.getTime() >= now.getTime() - ACHIEVEMENT_NOTIFY_WINDOW_DAYS * 86_400_000;
}

export const achievementDef = (code: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.code === code);
export const achievementIcon = (family: AchievementFamily): string =>
  ACHIEVEMENT_FAMILIES.find((f) => f.family === family)?.icon ?? 'presenca';

/** Progresso `current/target` (current limitado ao target) a partir dos contadores da derivacao; null = nao contavel. */
export function achievementProgress(def: AchievementDef, counters: DerivationCounters): { current: number; target: number } | null {
  if (def.target === null || def.counter === null) return null;
  return { current: Math.min(counters[def.counter], def.target), target: def.target };
}

/** Maximo de conquistas na vitrine do perfil. */
export const SHOWCASE_MAX = 3;

// ---------------------------------------------------------------------------------------------
// Datas / temporadas ('YYYY-MM' em America/Sao_Paulo)
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const SP_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 'YYYY-MM-DD' do dia em Sao Paulo de um INSTANTE (evento, roda, certificado, "agora"). */
export const spDay = (instant: Date): string => SP_DAY_FORMAT.format(instant);
/** 'YYYY-MM-DD' de uma DATA CIVIL (coluna gravada como meia-noite UTC do dia: aula, graduacao). */
export const civilDay = (date: Date): string => date.toISOString().slice(0, 10);
export const seasonOfDay = (day: string): string => day.slice(0, 7);
export const currentSeason = (now: Date = new Date()): string => seasonOfDay(spDay(now));

const SEASON_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isSeason = (value: string): boolean => SEASON_RE.test(value);

export function previousSeason(season: string): string {
  const [y, m] = season.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function lastInstantOfSeason(season: string): Date {
  const [y, m] = season.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1) - 1000); // 23:59:59 do ultimo dia (UTC)
}

/** Meio-dia UTC do dia civil (cai no mesmo dia em Sao Paulo e em UTC). */
export const dayToDate = (day: string): Date => new Date(`${day}T12:00:00.000Z`);

const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isDay = (value: string): boolean => DAY_RE.test(value);

/** Segunda-feira (inicio da semana) do dia civil 'YYYY-MM-DD'. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}
export const addDaysToDay = (day: string, n: number): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS);

/** Meses COMPLETOS entre dois dias civis (from <= to); 0 se to < from. */
export function fullMonthsBetween(from: string, to: string): number {
  if (to < from) return 0;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}
/** Dia civil `months` meses depois (overflow do calendario como em Date.UTC: 29/02 + 12 meses = 01/03). */
const addMonthsToDay = (day: string, months: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

/**
 * Dia civil ('YYYY-MM-DD') de um PointEvent: aula e graduacao gravam a DATA CIVIL como meia-noite UTC (civilDay); os
 * demais gravam um instante (spDay). Mesma convencao usada para a temporada (`season`) na derivacao.
 */
export function pointDay(type: PointEventType | string, occurredAt: Date): string {
  return type === PointEventType.CLASS_ATTENDANCE || type === PointEventType.GRADUATION ? civilDay(occurredAt) : spDay(occurredAt);
}

/** Maior sequencia de semanas consecutivas (segundas-feiras 'YYYY-MM-DD'). */
export function bestStreakWeeks(weekKeys: Iterable<string>): number {
  const sorted = [...new Set(weekKeys)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const wk of sorted) {
    run = prev !== null && addDaysToDay(prev, 7) === wk ? run + 1 : 1;
    prev = wk;
    if (run > best) best = run;
  }
  return best;
}

const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** 'YYYY-MM' -> 'outubro/2026'. */
export const monthLabelPt = (season: string): string => {
  const [y, m] = season.split('-').map(Number);
  return `${MONTHS_PT[m - 1] ?? season}/${y}`;
};

/**
 * Semanas consecutivas terminando na semana de `today` (ou na anterior, se a atual ainda nao teve presenca).
 * `weekKeys` = segundas-feiras ('YYYY-MM-DD') das semanas com pelo menos 1 presenca.
 */
export function currentStreakWeeks(weekKeys: Iterable<string>, today: string): number {
  const set = new Set(weekKeys);
  let cursor = weekStart(today);
  if (!set.has(cursor)) cursor = addDaysToDay(cursor, -7);
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = addDaysToDay(cursor, -7);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Derivacao dos pontos a partir das tabelas de origem
// ---------------------------------------------------------------------------------------------

export interface RankingSource {
  /** Chamadas de aulas ATIVAS do aluno (presente ou falta). `lessonDate` = data civil (meia-noite UTC). */
  attendances: Array<{ lessonId: number; lessonDate: Date; present: boolean }>;
  /** Eventos (nao cancelados/rascunho) em que o aluno esta ATTENDED. */
  events: Array<{ eventId: number; date: Date }>;
  /** Rodas (ja realizadas) em que o aluno participou (uma entrada por roda). */
  rodas: Array<{ rodaId: number; date: Date }>;
  graduations: Array<{ id: number; graduatedAt: Date; levelOrder: number }>;
  certificates: Array<{ id: number; issuedAt: Date }>;
  /** Dias ('YYYY-MM-DD', SP) com check-in diario do app (DailyCheckin). Opcional: ausente = nenhum. */
  dailyCheckins?: string[];
  /** Data de matricula do aluno no grupo (Student.joinedAt, data civil). Opcional: para as conquistas YEARS_*. */
  joinedAt?: Date | null;
}

export interface DerivedPoint {
  type: PointEventType;
  points: number;
  refType: string;
  refId: string;
  occurredAt: Date;
  season: string;
}

export interface DerivedAchievement {
  code: string;
  earnedAt: Date;
}

export interface Derivation {
  points: DerivedPoint[];
  achievements: DerivedAchievement[];
  /** Segundas-feiras das semanas com presenca contada (para a sequencia atual). */
  weekKeys: string[];
  /** Contadores usados para conceder as conquistas (progresso e a mesma fonte). */
  counters: DerivationCounters;
  /** Primeira data conhecida do aluno no grupo ('YYYY-MM-DD'; matricula ou primeira presenca, a mais antiga). */
  firstKnownDay: string | null;
}

/** Concede `code` quando a lista ordenada alcanca `n` itens (earnedAt = data do n-esimo). */
function grantAtCount<T>(out: DerivedAchievement[], code: string, sorted: readonly T[], n: number, dateOf: (item: T) => Date): void {
  if (sorted.length >= n) out.push({ code, earnedAt: dateOf(sorted[n - 1]) });
}

const STREAK_ACHIEVEMENTS: ReadonlyArray<[string, number]> = [
  ['SEQ_4W', 4],
  ['SEQ_8W', 8],
  ['SEQ_12W', 12],
  ['SEQ_26W', 26],
  ['SEQ_52W', 52],
];
/** Dias sem nenhuma presenca para a proxima contar como "voltou a treinar" (COMEBACK). */
export const COMEBACK_GAP_DAYS = 30;

/** Eventos futuros alem de 1 dia nao pontuam (check-in antecipado/erro de digitacao nao antecipa pontos). */
const FUTURE_TOLERANCE_MS = DAY_MS;

export function derivePoints(source: RankingSource, now: Date = new Date()): Derivation {
  const today = spDay(now);
  const thisSeason = seasonOfDay(today);
  const points: DerivedPoint[] = [];
  const achievements: DerivedAchievement[] = [];

  // --- CLASS_ATTENDANCE: 10 por aula presente; max 3 por dia civil; so aulas ate hoje ---
  const presentByLesson = new Map<number, (typeof source.attendances)[number]>();
  for (const a of source.attendances) if (a.present) presentByLesson.set(a.lessonId, a); // 1 ponto por aula, no maximo
  const presents = [...presentByLesson.values()]
    .map((a) => ({ lessonId: a.lessonId, day: civilDay(a.lessonDate), date: a.lessonDate }))
    .filter((a) => a.day <= today)
    .sort((a, b) => (a.day === b.day ? a.lessonId - b.lessonId : a.day < b.day ? -1 : 1));
  const perDay = new Map<string, number>();
  const counted: typeof presents = [];
  for (const p of presents) {
    const n = perDay.get(p.day) ?? 0;
    if (n >= MAX_CLASS_POINTS_PER_DAY) continue;
    perDay.set(p.day, n + 1);
    counted.push(p);
    points.push({
      type: PointEventType.CLASS_ATTENDANCE,
      points: POINTS.CLASS_ATTENDANCE,
      refType: 'Lesson',
      refId: String(p.lessonId),
      occurredAt: p.date,
      season: seasonOfDay(p.day),
    });
  }

  // --- STREAK_BONUS: semanas consecutivas (segunda a domingo) com >=1 presenca contada ---
  const lastDayOfWeek = new Map<string, string>();
  for (const p of counted) {
    const wk = weekStart(p.day);
    const prev = lastDayOfWeek.get(wk);
    if (!prev || p.day > prev) lastDayOfWeek.set(wk, p.day);
  }
  const weekKeys = [...lastDayOfWeek.keys()].sort();
  let streak = 0;
  let bestStreak = 0;
  let previousWeek: string | null = null;
  const streakDates = new Map<string, Date>();
  for (const wk of weekKeys) {
    streak = previousWeek !== null && addDaysToDay(previousWeek, 7) === wk ? streak + 1 : 1;
    previousWeek = wk;
    if (streak > bestStreak) bestStreak = streak;
    const lastDay = lastDayOfWeek.get(wk) as string;
    for (const [code, n] of STREAK_ACHIEVEMENTS) {
      if (streak >= n && !streakDates.has(code)) streakDates.set(code, dayToDate(lastDay));
    }
    if (streak >= 2) {
      points.push({
        type: PointEventType.STREAK_BONUS,
        points: Math.min(POINTS.STREAK_STEP * (streak - 1), POINTS.STREAK_MAX),
        refType: 'Week',
        refId: wk,
        occurredAt: dayToDate(lastDay),
        season: seasonOfDay(lastDay),
      });
    }
  }
  for (const [code] of STREAK_ACHIEVEMENTS) {
    const at = streakDates.get(code);
    if (at) achievements.push({ code, earnedAt: at });
  }

  // --- MONTHLY_CONSISTENCY / PERFECT_MONTH: so meses ja encerrados, com >=4 chamadas ---
  const byMonth = new Map<string, { total: number; present: number }>();
  for (const a of source.attendances) {
    const day = civilDay(a.lessonDate);
    if (day > today) continue;
    const month = seasonOfDay(day);
    const row = byMonth.get(month) ?? { total: 0, present: 0 };
    row.total += 1;
    if (a.present) row.present += 1;
    byMonth.set(month, row);
  }
  let perfectAt: Date | null = null;
  let consistentRun = 0;
  let bestConsistent = 0;
  let previousConsistent: string | null = null;
  const consistentDates = new Map<number, Date>();
  for (const month of [...byMonth.keys()].sort()) {
    if (month >= thisSeason) continue;
    const { total, present } = byMonth.get(month) as { total: number; present: number };
    if (total < CONSISTENCY_MIN_LESSONS) continue;
    if (present / total >= CONSISTENCY_MIN_RATE) {
      // meses SEGUIDOS (calendario) com bonus de consistencia: CONSISTENT_3M / CONSISTENT_6M
      consistentRun = previousConsistent !== null && previousSeason(month) === previousConsistent ? consistentRun + 1 : 1;
      previousConsistent = month;
      if (consistentRun > bestConsistent) bestConsistent = consistentRun;
      for (const n of [3, 6]) if (consistentRun >= n && !consistentDates.has(n)) consistentDates.set(n, lastInstantOfSeason(month));
      points.push({
        type: PointEventType.MONTHLY_CONSISTENCY,
        points: POINTS.MONTHLY_CONSISTENCY,
        refType: 'Month',
        refId: month,
        occurredAt: lastInstantOfSeason(month),
        season: month,
      });
    }
    if (present === total && !perfectAt) perfectAt = lastInstantOfSeason(month);
  }
  if (perfectAt) achievements.push({ code: 'PERFECT_MONTH', earnedAt: perfectAt });
  for (const [n, code] of [[3, 'CONSISTENT_3M'], [6, 'CONSISTENT_6M']] as const) {
    const at = consistentDates.get(n);
    if (at) achievements.push({ code, earnedAt: at });
  }

  // --- EVENT_ATTENDANCE ---
  const events = source.events
    .filter((e) => e.date.getTime() <= now.getTime() + FUTURE_TOLERANCE_MS)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.eventId - b.eventId);
  for (const e of events) {
    points.push({
      type: PointEventType.EVENT_ATTENDANCE,
      points: POINTS.EVENT_ATTENDANCE,
      refType: 'Event',
      refId: String(e.eventId),
      occurredAt: e.date,
      season: seasonOfDay(spDay(e.date)),
    });
  }
  for (const [code, n] of [['EVENT_1', 1], ['EVENT_5', 5], ['EVENT_15', 15], ['EVENT_30', 30]] as const) {
    grantAtCount(achievements, code, events, n, (e) => e.date);
  }

  // --- RODA_PARTICIPATION (so rodas ja realizadas) ---
  const rodas = source.rodas
    .filter((r) => r.date.getTime() <= now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.rodaId - b.rodaId);
  for (const r of rodas) {
    points.push({
      type: PointEventType.RODA_PARTICIPATION,
      points: POINTS.RODA_PARTICIPATION,
      refType: 'Roda',
      refId: String(r.rodaId),
      occurredAt: r.date,
      season: seasonOfDay(spDay(r.date)),
    });
  }
  for (const [code, n] of [['RODA_1', 1], ['RODA_10', 10], ['RODA_25', 25], ['RODA_50', 50]] as const) {
    grantAtCount(achievements, code, rodas, n, (r) => r.date);
  }

  // --- GRADUATION: 100 x ordem da corda (minimo 1) ---
  const graduations = [...source.graduations].sort((a, b) => a.graduatedAt.getTime() - b.graduatedAt.getTime() || a.id - b.id);
  for (const g of graduations) {
    points.push({
      type: PointEventType.GRADUATION,
      points: POINTS.GRADUATION_PER_LEVEL * Math.max(1, g.levelOrder),
      refType: 'StudentGraduation',
      refId: String(g.id),
      occurredAt: g.graduatedAt,
      season: seasonOfDay(civilDay(g.graduatedAt)),
    });
  }
  for (const [code, n] of [['FIRST_GRADUATION', 1], ['GRADUATIONS_3', 3], ['GRADUATIONS_5', 5]] as const) {
    grantAtCount(achievements, code, graduations, n, (g) => g.graduatedAt);
  }

  // --- CERTIFICATE ---
  for (const c of source.certificates) {
    points.push({
      type: PointEventType.CERTIFICATE,
      points: POINTS.CERTIFICATE,
      refType: 'Certificate',
      refId: String(c.id),
      occurredAt: c.issuedAt,
      season: seasonOfDay(spDay(c.issuedAt)),
    });
  }

  const certificatesSorted = [...source.certificates].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime() || a.id - b.id);
  grantAtCount(achievements, 'CERTIFICATES_3', certificatesSorted, 3, (c) => c.issuedAt);

  // --- PRESENCA: aulas presentes (contadas). CENTURION (100) e' o original ---
  for (const [code, n] of [['AULAS_25', 25], ['CENTURION', 100], ['AULAS_250', 250], ['AULAS_500', 500], ['AULAS_1000', 1000]] as const) {
    grantAtCount(achievements, code, counted, n, (p) => p.date);
  }

  // --- TEMPO: YEARS_* desde a primeira data conhecida (matricula ou primeira presenca, a mais antiga que existir) ---
  const candidates = [source.joinedAt ? civilDay(source.joinedAt) : null, presents[0]?.day ?? null].filter(
    (d): d is string => d !== null && d <= today,
  );
  const firstKnownDay = candidates.length > 0 ? candidates.sort()[0] : null;
  const monthsInGroup = firstKnownDay ? fullMonthsBetween(firstKnownDay, today) : 0;
  if (firstKnownDay) {
    for (const [code, years] of [['YEARS_1', 1], ['YEARS_2', 2], ['YEARS_5', 5]] as const) {
      if (monthsInGroup >= years * 12) achievements.push({ code, earnedAt: dayToDate(addMonthsToDay(firstKnownDay, years * 12)) });
    }
  }

  // --- COMEBACK: uma presenca contada depois de >= 30 dias sem nenhuma (a primeira vez que acontece) ---
  for (let i = 1; i < counted.length; i += 1) {
    if (daysBetween(counted[i - 1].day, counted[i].day) >= COMEBACK_GAP_DAYS) {
      achievements.push({ code: 'COMEBACK', earnedAt: counted[i].date });
      break;
    }
  }

  // --- CHECK-IN DIARIO: 1 ponto por dia (ate DAILY_MONTH_CAP_DAYS por mes) + bonus de semana ENCERRADA em dia ---
  const dailyDays = [...new Set(source.dailyCheckins ?? [])].filter((d) => isDay(d) && d <= today).sort();
  const dailyPerMonth = new Map<string, number>();
  const dailyPerWeek = new Map<string, number>();
  for (const d of dailyDays) {
    const month = seasonOfDay(d);
    const n = dailyPerMonth.get(month) ?? 0;
    dailyPerMonth.set(month, n + 1);
    const wk = weekStart(d);
    dailyPerWeek.set(wk, (dailyPerWeek.get(wk) ?? 0) + 1);
    if (n >= DAILY_MONTH_CAP_DAYS) continue; // passou do teto do mes: conta para a semana e as conquistas, sem ponto
    points.push({
      type: PointEventType.DAILY_CHECKIN,
      points: POINTS.DAILY_CHECKIN,
      refType: 'Day',
      refId: d,
      occurredAt: dayToDate(d),
      season: month,
    });
  }
  let dailyRun = 0;
  let bestDailyRun = 0;
  let previousOkWeek: string | null = null;
  let weekOk4At: Date | null = null;
  for (const wk of [...dailyPerWeek.keys()].sort()) {
    const sunday = addDaysToDay(wk, 6);
    if (sunday >= today) continue; // semana ainda nao encerrada (domingo e' hoje ou depois)
    if ((dailyPerWeek.get(wk) ?? 0) < DAILY_WEEK_TARGET) continue;
    dailyRun = previousOkWeek !== null && addDaysToDay(previousOkWeek, 7) === wk ? dailyRun + 1 : 1;
    previousOkWeek = wk;
    if (dailyRun > bestDailyRun) bestDailyRun = dailyRun;
    if (dailyRun >= 4 && !weekOk4At) weekOk4At = dayToDate(sunday);
    points.push({
      type: PointEventType.DAILY_WEEK_BONUS,
      points: POINTS.DAILY_WEEK_BONUS,
      refType: 'Week',
      refId: wk,
      occurredAt: dayToDate(sunday),
      season: seasonOfDay(sunday),
    });
  }
  for (const [code, n] of [['DAILY_7', 7], ['DAILY_30', 30], ['DAILY_100', 100]] as const) {
    grantAtCount(achievements, code, dailyDays, n, (d) => dayToDate(d));
  }
  if (weekOk4At) achievements.push({ code: 'WEEK_OK_4', earnedAt: weekOk4At });

  const counters: DerivationCounters = {
    lessons: counted.length,
    bestStreakWeeks: bestStreak,
    bestConsistentMonths: bestConsistent,
    rodas: rodas.length,
    events: events.length,
    graduations: graduations.length,
    certificates: source.certificates.length,
    monthsInGroup,
    dailyCheckins: dailyDays.length,
    bestDailyWeekRun: bestDailyRun,
  };
  return { points, achievements, weekKeys, counters, firstKnownDay };
}

// ---------------------------------------------------------------------------------------------
// "Como funciona" (GET /ranking/rules): as constantes REAIS daqui, nunca numeros fixos no app
// ---------------------------------------------------------------------------------------------

export const CATEGORY_TEXTS: Record<RankingCategory, { label: string; description: string }> = {
  GENERAL: { label: 'Geral', description: 'Todos os pontos: treinos, rodas, eventos, graduações, certificados e check-in diário.' },
  TRAINING: { label: 'Treino', description: 'Aulas presentes, bônus de sequência semanal e bônus de mês consistente.' },
  RODAS: { label: 'Rodas', description: 'Participação em rodas.' },
  EVENTS: { label: 'Eventos', description: 'Presença em eventos do grupo.' },
};
export const BAND_LABELS: Record<RankingBand, string> = { KIDS: 'Crianças (até 12 anos)', YOUTH: 'Jovens (13 a 17 anos)', ADULT: 'Adultos (18 anos ou mais)' };

export function rankingRules() {
  return {
    points: {
      classAttendance: POINTS.CLASS_ATTENDANCE,
      streakStep: POINTS.STREAK_STEP,
      streakMax: POINTS.STREAK_MAX,
      eventAttendance: POINTS.EVENT_ATTENDANCE,
      rodaParticipation: POINTS.RODA_PARTICIPATION,
      monthlyConsistency: POINTS.MONTHLY_CONSISTENCY,
      graduationPerLevel: POINTS.GRADUATION_PER_LEVEL,
      certificate: POINTS.CERTIFICATE,
      dailyCheckin: POINTS.DAILY_CHECKIN,
      dailyWeekBonus: POINTS.DAILY_WEEK_BONUS,
    },
    limits: {
      maxClassPointsPerDay: MAX_CLASS_POINTS_PER_DAY,
      consistencyMinRate: CONSISTENCY_MIN_RATE,
      consistencyMinLessons: CONSISTENCY_MIN_LESSONS,
      dailyWeekTarget: DAILY_WEEK_TARGET,
      dailyMonthCapDays: DAILY_MONTH_CAP_DAYS,
    },
    leagues: LEAGUES.map((l) => ({ code: l.code, name: l.name, color: l.color, minPoints: l.minPoints })),
    categories: CATEGORIES.map((code) => ({ code, ...CATEGORY_TEXTS[code] })),
    bands: BANDS.map((code) => ({ code, label: BAND_LABELS[code] })),
    achievements: ACHIEVEMENTS.map((a) => ({ code: a.code, name: a.name, description: a.description, family: a.family, tier: a.tier })),
    seasons: { lengthLabel: 'mensal' as const, timezone: 'America/Sao_Paulo' as const },
  };
}

// ---------------------------------------------------------------------------------------------
// Privacidade / apresentacao
// ---------------------------------------------------------------------------------------------

export const BANDS = ['KIDS', 'YOUTH', 'ADULT'] as const;
export type RankingBand = (typeof BANDS)[number];

/** Idade completa em anos (null sem data de nascimento). */
export function ageInYears(birthDate: Date | null, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

/** KIDS <= 12, YOUTH 13-17, ADULT >= 18 (sem birthDate = ADULT). */
export function bandOf(birthDate: Date | null, now: Date = new Date()): RankingBand {
  const age = ageInYears(birthDate, now);
  if (age === null || age >= 18) return 'ADULT';
  return age <= 12 ? 'KIDS' : 'YOUTH';
}

/** Sem birthDate nao ha como provar menoridade (mesma regra do Passaporte): trata como adulto. */
export const isMinor = (birthDate: Date | null, now: Date = new Date()): boolean => {
  const age = ageInYears(birthDate, now);
  return age !== null && age < 18;
};

/** 'Maria da Silva' -> 'Maria S.' (primeiro nome + inicial do ultimo sobrenome). */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Aluno';
  if (parts.length === 1) return parts[0];
  const initial = Array.from(parts[parts.length - 1])[0].toUpperCase();
  return `${parts[0]} ${initial}.`;
}

/** Apelido (se houver) no lugar do nome curto. */
export const displayNameOf = (fullName: string, nickname: string | null | undefined): string =>
  nickname && nickname.trim() ? nickname.trim() : shortName(fullName);

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 20;
const NICKNAME_RE = /^[\p{L}\p{N} ._-]+$/u;

/** Lista de bloqueio PEQUENA (palavrolao comum em pt-BR). Curtas: so como palavra inteira; longas: como prefixo. */
const BLOCKED_EXACT = new Set(['cu', 'pau', 'fdp', 'foda', 'fode', 'pqp', 'vsf', 'tnc', 'puta', 'putas', 'puto', 'putos', 'cuzao', 'xota']);
const BLOCKED_PREFIX = [
  'porra', 'caralho', 'merda', 'buceta', 'xereca', 'piroca', 'viado', 'bosta', 'arrombad', 'babaca', 'otario',
  'retardad', 'nazista', 'hitler', 'estupr', 'vagabund', 'cacete', 'punheta', 'neguinho',
];

function foldForProfanity(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a');
}

export function hasBlockedWord(text: string): boolean {
  const tokens = foldForProfanity(text).split(/[^a-z]+/).filter(Boolean);
  return tokens.some((t) => BLOCKED_EXACT.has(t) || BLOCKED_PREFIX.some((p) => t.startsWith(p)));
}

export type NicknameCheck = { ok: true; value: string | null } | { ok: false; message: string };

/** null/vazio limpa o apelido; senao 2-20 caracteres (letras/numeros/espaco/._-), sem palavrao simples. */
export function checkNickname(raw: string | null | undefined): NicknameCheck {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: true, value: null };
  const length = Array.from(value).length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return { ok: false, message: `O apelido deve ter entre ${NICKNAME_MIN} e ${NICKNAME_MAX} caracteres.` };
  }
  if (!NICKNAME_RE.test(value)) {
    return { ok: false, message: 'O apelido só pode ter letras, números, espaço, ponto, hífen e sublinhado.' };
  }
  if (hasBlockedWord(value)) {
    return { ok: false, message: 'Esse apelido não é permitido. Escolha outro.' };
  }
  return { ok: true, value };
}
