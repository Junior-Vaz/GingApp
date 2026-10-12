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
} as const;

/** Anti-fraude: no maximo 1 CLASS_ATTENDANCE por aula (unique por refId) e 3 por dia civil. */
export const MAX_CLASS_POINTS_PER_DAY = 3;
/** MONTHLY_CONSISTENCY: frequencia minima do mes e numero minimo de aulas (com chamada) no mes. */
export const CONSISTENCY_MIN_RATE = 0.8;
export const CONSISTENCY_MIN_LESSONS = 4;

export const CATEGORIES = ['GENERAL', 'TRAINING', 'RODAS', 'EVENTS'] as const;
export type RankingCategory = (typeof CATEGORIES)[number];

/** category -> tipos de ponto somados (GENERAL = todos = null). */
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
  { code: 'CRUA', name: 'Crua', color: '#E5E5E5', minPoints: 0 },
  { code: 'VERDE', name: 'Verde', color: '#22C55E', minPoints: 300 },
  { code: 'AMARELA', name: 'Amarela', color: '#FACC15', minPoints: 900 },
  { code: 'AZUL', name: 'Azul', color: '#3B82F6', minPoints: 2000 },
  { code: 'ROXA', name: 'Roxa', color: '#8B5CF6', minPoints: 4000 },
  { code: 'MARROM', name: 'Marrom', color: '#92400E', minPoints: 7500 },
  { code: 'PRETA', name: 'Preta', color: '#111827', minPoints: 12000 },
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

export interface AchievementDef {
  code: string;
  name: string;
  description: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { code: 'SEQ_4W', name: 'Sequência de 4 semanas', description: 'Treinou 4 semanas seguidas.' },
  { code: 'FIRST_GRADUATION', name: 'Primeira corda', description: 'Recebeu a primeira graduação.' },
  { code: 'RODA_10', name: 'Rodeiro', description: 'Participou de 10 rodas.' },
  { code: 'EVENT_5', name: 'Presença em eventos', description: 'Esteve em 5 eventos do grupo.' },
  { code: 'PERFECT_MONTH', name: 'Mês perfeito', description: '100% de presença em um mês (mínimo de 4 aulas).' },
  { code: 'CENTURION', name: 'Centurião', description: 'Chegou a 100 aulas presentes.' },
];

export const achievementDef = (code: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.code === code);

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

const dayToDate = (day: string): Date => new Date(`${day}T12:00:00.000Z`);

/** Segunda-feira (inicio da semana) do dia civil 'YYYY-MM-DD'. */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}
const addDaysToDay = (day: string, n: number): string => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

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
}

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
  let previousWeek: string | null = null;
  let seq4Date: Date | null = null;
  for (const wk of weekKeys) {
    streak = previousWeek !== null && addDaysToDay(previousWeek, 7) === wk ? streak + 1 : 1;
    previousWeek = wk;
    const lastDay = lastDayOfWeek.get(wk) as string;
    if (streak >= 4 && !seq4Date) seq4Date = dayToDate(lastDay);
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
  if (seq4Date) achievements.push({ code: 'SEQ_4W', earnedAt: seq4Date });

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
  for (const month of [...byMonth.keys()].sort()) {
    if (month >= thisSeason) continue;
    const { total, present } = byMonth.get(month) as { total: number; present: number };
    if (total < CONSISTENCY_MIN_LESSONS) continue;
    if (present / total >= CONSISTENCY_MIN_RATE) {
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
  if (events.length >= 5) achievements.push({ code: 'EVENT_5', earnedAt: events[4].date });

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
  if (rodas.length >= 10) achievements.push({ code: 'RODA_10', earnedAt: rodas[9].date });

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
  if (graduations.length >= 1) achievements.push({ code: 'FIRST_GRADUATION', earnedAt: graduations[0].graduatedAt });

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

  // --- CENTURION: 100 aulas presentes (contadas) ---
  if (counted.length >= 100) achievements.push({ code: 'CENTURION', earnedAt: counted[99].date });

  return { points, achievements, weekKeys };
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
