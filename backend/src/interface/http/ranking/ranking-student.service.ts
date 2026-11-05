import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PointEventType, Prisma, RecordStatus, Student, StudentStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  EVOLUTION_DEFAULT_COUNT,
  EvolutionQueryDto,
  POINTS_DEFAULT_LIMIT,
  PointStatementQueryDto,
} from './dto/ranking.dto';
import { RankingQueryService } from './ranking-query.service';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_FAMILIES,
  CONSISTENCY_MIN_LESSONS,
  CONSISTENCY_MIN_RATE,
  DAILY_MONTH_CAP_DAYS,
  DAILY_WEEK_TARGET,
  LEAGUE_MARKER_PREFIX,
  POINTS,
  TIERS,
  achievementDef,
  achievementIcon,
  achievementProgress,
  addDaysToDay,
  bestStreakWeeks,
  civilDay,
  currentSeason,
  currentStreakWeeks,
  leagueFor,
  levelView,
  monthLabelPt,
  nextLeagueFor,
  pointDay,
  previousSeason,
  progressPct,
  rankingRules,
  seasonOfDay,
  spDay,
  weekStart,
} from './ranking-rules';
import { RankingService } from './ranking.service';

/** Raridade so com grupo de pelo menos 10 alunos ATIVOS (abaixo disso o percentual identificaria pessoas). */
export const RARITY_MIN_ACTIVE_STUDENTS = 10;
const SEASON_TOTALS_MAX = 24;

/** Rotulo generico por tipo (origem apagada/ilegivel nunca vira erro). */
const GENERIC_LABEL: Record<PointEventType, string> = {
  CLASS_ATTENDANCE: 'Aula',
  STREAK_BONUS: 'Bônus de sequência',
  EVENT_ATTENDANCE: 'Evento',
  RODA_PARTICIPATION: 'Roda',
  MONTHLY_CONSISTENCY: 'Mês consistente',
  GRADUATION: 'Graduação',
  CERTIFICATE: 'Certificado',
  DAILY_CHECKIN: 'Check-in do dia',
  DAILY_WEEK_BONUS: 'Semana em dia',
};

export interface PointStatementItem {
  id: number;
  type: PointEventType;
  points: number;
  occurredAt: string;
  season: string;
  label: string;
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

const ids = (refIds: string[]): number[] =>
  [...new Set(refIds.map((r) => Number(r)).filter((n) => Number.isInteger(n) && n > 0))];

/**
 * Ginga Rank — lado do aluno (docs/CONTRATO_RANK_ALUNO.md): "Como funciona", extrato, evolucao, meta do mes, conquistas
 * (progresso/raridade/vitrine) e check-in diario. Sempre o PROPRIO aluno ou dependente (`?studentId=` conferido pela
 * mesma regra do GET /ranking/me: RankingQueryService.viewerStudent). Nada de outros alunos sai daqui (raridade e'
 * agregada e oculta em grupo pequeno).
 */
@Injectable()
export class RankingStudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: RankingQueryService,
    private readonly ranking: RankingService,
  ) {}

  /** Aluno do usuario (proprio/dependente). Sem aluno ligado / sem vinculo = 404 (mesma resposta do /ranking/me). */
  private async studentOf(user: AuthenticatedUser, studentId?: number): Promise<Student> {
    const organizationId = this.query.orgOf(user);
    const student = await this.query.viewerStudent(organizationId, user.id, studentId);
    if (!student) throw new NotFoundException('Aluno não encontrado.');
    return student;
  }

  /** Check-in diario: so aluno ATIVO. */
  private async activeStudentOf(user: AuthenticatedUser, studentId?: number): Promise<Student> {
    const student = await this.studentOf(user, studentId);
    if (student.status !== StudentStatus.ACTIVE) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'O check-in diário é só para aluno ativo no grupo.',
        code: 'STUDENT_NOT_ACTIVE',
      });
    }
    return student;
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/rules
  // ---------------------------------------------------------------------------------------------

  rules() {
    return rankingRules();
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/me/points (extrato)
  // ---------------------------------------------------------------------------------------------

  async points(user: AuthenticatedUser, q: PointStatementQueryDto) {
    const student = await this.studentOf(user, q.studentId);
    const season = q.season ?? 'ALL';
    const limit = q.limit ?? POINTS_DEFAULT_LIMIT;
    const offset = q.offset ?? 0;
    const where: Prisma.PointEventWhereInput = { studentId: student.id, ...(season !== 'ALL' ? { season } : {}) };
    const [rows, total, bySeason] = await Promise.all([
      this.prisma.pointEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset }),
      this.prisma.pointEvent.count({ where }),
      this.prisma.pointEvent.groupBy({ by: ['season'], where: { studentId: student.id }, _sum: { points: true }, orderBy: { season: 'desc' } }),
    ]);
    const labels = await this.labelsFor(student, rows);
    const items: PointStatementItem[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      points: r.points,
      occurredAt: r.occurredAt.toISOString(),
      season: r.season,
      label: labels.get(r.id) ?? GENERIC_LABEL[r.type],
    }));
    return {
      items,
      total,
      seasonTotals: bySeason.slice(0, SEASON_TOTALS_MAX).map((s) => ({ season: s.season, points: s._sum.points ?? 0 })),
      allTimePoints: bySeason.reduce((sum, s) => sum + (s._sum.points ?? 0), 0),
    };
  }

  /**
   * Rotulos pt-BR montados em LOTE (no maximo uma consulta por tipo presente na pagina; nunca uma por linha). Origem so
   * do proprio grupo / do proprio aluno; apagada, de outro grupo ou ilegivel = rotulo generico do tipo.
   */
  private async labelsFor(
    student: Student,
    rows: Array<{ id: number; type: PointEventType; refId: string; occurredAt: Date }>,
  ): Promise<Map<number, string>> {
    const labels = new Map<number, string>();
    const of = (type: PointEventType) => rows.filter((r) => r.type === type);
    const orgId = student.organizationId;
    const byId = <T extends { id: number }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

    const lessonRows = of(PointEventType.CLASS_ATTENDANCE);
    const eventRows = of(PointEventType.EVENT_ATTENDANCE);
    const rodaRows = of(PointEventType.RODA_PARTICIPATION);
    const gradRows = of(PointEventType.GRADUATION);
    const certRows = of(PointEventType.CERTIFICATE);
    const streakRows = of(PointEventType.STREAK_BONUS);
    const weekRows = of(PointEventType.DAILY_WEEK_BONUS);

    const weekBounds = weekRows.map((r) => r.refId).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const [lessons, events, rodas, grads, certs, attendanceWeeks, checkins] = await Promise.all([
      lessonRows.length
        ? this.prisma.lesson.findMany({
            where: { id: { in: ids(lessonRows.map((r) => r.refId)) }, organizationId: orgId },
            select: { id: true, class: { select: { name: true } } },
          })
        : Promise.resolve([]),
      eventRows.length
        ? this.prisma.event.findMany({ where: { id: { in: ids(eventRows.map((r) => r.refId)) }, organizationId: orgId }, select: { id: true, title: true } })
        : Promise.resolve([]),
      // Roda do proprio grupo ou da comunidade (sem grupo, publica); roda de outro grupo = rotulo generico.
      rodaRows.length
        ? this.prisma.roda.findMany({
            where: { id: { in: ids(rodaRows.map((r) => r.refId)) }, OR: [{ organizationId: orgId }, { organizationId: null }] },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      gradRows.length
        ? this.prisma.studentGraduation.findMany({
            where: { id: { in: ids(gradRows.map((r) => r.refId)) }, studentId: student.id },
            select: { id: true, graduationLevel: { select: { name: true } } },
          })
        : Promise.resolve([]),
      certRows.length
        ? this.prisma.certificate.findMany({ where: { id: { in: ids(certRows.map((r) => r.refId)) }, studentId: student.id }, select: { id: true, title: true } })
        : Promise.resolve([]),
      // Sequencia: semanas com aula presente CONTADA (os mesmos CLASS_ATTENDANCE de que o bonus foi derivado).
      streakRows.length
        ? this.prisma.pointEvent.findMany({ where: { studentId: student.id, type: PointEventType.CLASS_ATTENDANCE }, select: { occurredAt: true } })
        : Promise.resolve([]),
      weekBounds.length
        ? this.prisma.dailyCheckin.findMany({
            where: { studentId: student.id, day: { gte: weekBounds[0], lte: addDaysToDay(weekBounds[weekBounds.length - 1], 6) } },
            select: { day: true },
          })
        : Promise.resolve([]),
    ]);

    const lessonById = byId(lessons);
    for (const r of lessonRows) {
      const name = lessonById.get(Number(r.refId))?.class?.name?.trim();
      if (name) labels.set(r.id, `Aula: ${name}`);
    }
    const eventById = byId(events);
    for (const r of eventRows) {
      const title = eventById.get(Number(r.refId))?.title?.trim();
      if (title) labels.set(r.id, `Evento: ${title}`);
    }
    const rodaById = byId(rodas);
    for (const r of rodaRows) {
      const title = rodaById.get(Number(r.refId))?.title?.trim();
      if (title) labels.set(r.id, `Roda: ${title}`);
    }
    const gradById = byId(grads);
    for (const r of gradRows) {
      const level = gradById.get(Number(r.refId))?.graduationLevel?.name?.trim();
      if (level) labels.set(r.id, `Graduação: ${level}`);
    }
    const certById = byId(certs);
    for (const r of certRows) {
      const title = certById.get(Number(r.refId))?.title?.trim();
      if (title) labels.set(r.id, `Certificado: ${title}`);
    }
    if (streakRows.length) {
      const weeks = new Set(attendanceWeeks.map((p) => weekStart(civilDay(p.occurredAt))));
      for (const r of streakRows) {
        if (!weeks.has(r.refId)) continue;
        let n = 0;
        for (let wk = r.refId; weeks.has(wk); wk = addDaysToDay(wk, -7)) n += 1;
        labels.set(r.id, `Bônus de sequência (${n}ª semana seguida)`);
      }
    }
    for (const r of of(PointEventType.MONTHLY_CONSISTENCY)) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(r.refId)) labels.set(r.id, `Mês consistente: ${monthLabelPt(r.refId)}`);
    }
    for (const r of of(PointEventType.DAILY_CHECKIN)) {
      const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(r.refId);
      if (m) labels.set(r.id, `Check-in do dia ${m[2]}/${m[1]}`);
    }
    if (weekRows.length) {
      const perWeek = new Map<string, number>();
      for (const c of checkins) perWeek.set(weekStart(c.day), (perWeek.get(weekStart(c.day)) ?? 0) + 1);
      for (const r of weekRows) {
        const n = perWeek.get(r.refId);
        if (n) labels.set(r.id, `Semana em dia (${n} check-ins)`);
      }
    }
    return labels;
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/me/evolution
  // ---------------------------------------------------------------------------------------------

  async evolution(user: AuthenticatedUser, q: EvolutionQueryDto, now: Date = new Date()) {
    const student = await this.studentOf(user, q.studentId);
    const granularity = q.granularity ?? 'WEEK';
    const count = q.count ?? EVOLUTION_DEFAULT_COUNT;
    const today = spDay(now);

    const keys: string[] = [];
    let cursor = granularity === 'WEEK' ? weekStart(today) : seasonOfDay(today);
    for (let i = 0; i < count; i += 1) {
      keys.unshift(cursor);
      cursor = granularity === 'WEEK' ? addDaysToDay(cursor, -7) : previousSeason(cursor);
    }

    // Um aluno so (indice studentId): todos os pontos dele, agregados aqui.
    const rows = await this.prisma.pointEvent.findMany({
      where: { studentId: student.id },
      select: { type: true, points: true, occurredAt: true, season: true },
    });
    const keyOf = (r: (typeof rows)[number]) => (granularity === 'WEEK' ? weekStart(pointDay(r.type, r.occurredAt)) : r.season);
    const sums = new Map<string, { points: number; lessons: number }>();
    const weekly = new Map<string, number>();
    const attendanceWeeks = new Set<string>();
    for (const r of rows) {
      const k = keyOf(r);
      const cell = sums.get(k) ?? { points: 0, lessons: 0 };
      cell.points += r.points;
      if (r.type === PointEventType.CLASS_ATTENDANCE) cell.lessons += 1;
      sums.set(k, cell);
      const wk = weekStart(pointDay(r.type, r.occurredAt));
      weekly.set(wk, (weekly.get(wk) ?? 0) + r.points);
      if (r.type === PointEventType.CLASS_ATTENDANCE) attendanceWeeks.add(wk);
    }
    const before = [...sums.entries()].filter(([k]) => k < keys[0]).reduce((n, [, v]) => n + v.points, 0);
    let cumulative = before;
    const points = keys.map((key) => {
      const cell = sums.get(key) ?? { points: 0, lessons: 0 };
      cumulative += cell.points;
      return { key, points: cell.points, cumulative, lessons: cell.lessons };
    });

    let bestWeek: { key: string; points: number } | null = null;
    for (const [key, pts] of [...weekly.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (pts > 0 && (!bestWeek || pts > bestWeek.points)) bestWeek = { key, points: pts };
    }
    return {
      granularity,
      points,
      bestWeek,
      currentStreakWeeks: currentStreakWeeks(attendanceWeeks, today),
      bestStreakWeeks: bestStreakWeeks(attendanceWeeks),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/me/goal
  // ---------------------------------------------------------------------------------------------

  async goal(user: AuthenticatedUser, studentId: number | undefined, now: Date = new Date()) {
    const student = await this.studentOf(user, studentId);
    const today = spDay(now);
    const season = currentSeason(now);
    const [y, m] = season.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const nextMonthStart = new Date(Date.UTC(y, m, 1));

    const enrollments = await this.prisma.classStudent.findMany({
      where: { studentId: student.id, organizationId: student.organizationId, status: RecordStatus.ACTIVE, class: { status: RecordStatus.ACTIVE } },
      select: { classId: true },
    });
    const classIds = [...new Set(enrollments.map((e) => e.classId))];
    const [lessons, present, allTime] = await Promise.all([
      classIds.length
        ? this.prisma.lesson.findMany({
            where: {
              classId: { in: classIds },
              organizationId: student.organizationId,
              status: RecordStatus.ACTIVE,
              date: { gte: monthStart, lt: nextMonthStart },
            },
            select: { id: true, date: true, _count: { select: { attendances: true } } },
          })
        : Promise.resolve([]),
      this.prisma.pointEvent.count({ where: { studentId: student.id, type: PointEventType.CLASS_ATTENDANCE, season } }),
      this.prisma.pointEvent.aggregate({ _sum: { points: true }, where: { studentId: student.id } }),
    ]);

    // Uma linha por aula (id unico): a mesma aula nunca conta duas vezes.
    const lessonsPlanned = lessons.length;
    const done = lessons.filter((l) => civilDay(l.date) <= today && l._count.attendances > 0);
    const upcoming = lessons.filter((l) => civilDay(l.date) >= today && l._count.attendances === 0).length;
    const neededForBonus =
      lessonsPlanned > 0
        ? Math.max(Math.ceil(Math.round(CONSISTENCY_MIN_RATE * lessonsPlanned * 1e6) / 1e6), CONSISTENCY_MIN_LESSONS)
        : 0;
    const points = allTime._sum.points ?? 0;
    const current = leagueFor(points);
    const next = nextLeagueFor(points);
    return {
      season,
      lessonsPlanned,
      lessonsDone: done.length,
      present,
      neededForBonus,
      remainingForBonus: Math.max(0, neededForBonus - present),
      canStillReach: lessonsPlanned > 0 && present + upcoming >= neededForBonus,
      bonusPoints: POINTS.MONTHLY_CONSISTENCY,
      hasGoal: lessonsPlanned > 0,
      league: {
        current: levelView(current),
        next: next ? { ...levelView(next), minPoints: next.minPoints } : null,
        pointsToNext: next ? next.minPoints - points : 0,
        progressPct: progressPct(points),
      },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET /ranking/me/achievements
  // ---------------------------------------------------------------------------------------------

  async achievements(user: AuthenticatedUser, studentId: number | undefined, now: Date = new Date()) {
    const student = await this.studentOf(user, studentId);
    const catalogCodes = ACHIEVEMENTS.map((a) => a.code);
    const [derivation, rows, activeStudents, profile] = await Promise.all([
      this.ranking.deriveFor(student.id, now),
      this.prisma.achievement.findMany({
        where: { studentId: student.id, NOT: { code: { startsWith: LEAGUE_MARKER_PREFIX } } },
        select: { code: true, earnedAt: true },
      }),
      this.prisma.student.count({ where: { organizationId: student.organizationId, status: StudentStatus.ACTIVE } }),
      this.prisma.rankingProfile.findUnique({ where: { studentId: student.id }, select: { showcase: true } }),
    ]);
    // Raridade AGREGADA (contagem por codigo; ninguem identificado) e so com >= 10 alunos ativos.
    const rarityRows =
      activeStudents >= RARITY_MIN_ACTIVE_STUDENTS
        ? await this.prisma.achievement.groupBy({
            by: ['code'],
            where: { code: { in: catalogCodes }, student: { organizationId: student.organizationId, status: StudentStatus.ACTIVE } },
            _count: { _all: true },
          })
        : [];
    const holders = new Map(rarityRows.map((r) => [r.code, r._count._all]));
    const earnedAt = new Map(rows.map((r) => [r.code, r.earnedAt]));
    const counters = derivation?.counters;

    const familyIndex = (f: string) => ACHIEVEMENT_FAMILIES.findIndex((x) => x.family === f);
    const tierIndex = (t: string | null) => (t ? TIERS.indexOf(t as (typeof TIERS)[number]) : -1);
    const items = ACHIEVEMENTS.map((def, index) => ({ def, index }))
      .sort((a, b) => familyIndex(a.def.family) - familyIndex(b.def.family) || tierIndex(a.def.tier) - tierIndex(b.def.tier) || a.index - b.index)
      .map(({ def }) => {
        const at = earnedAt.get(def.code) ?? null;
        const base = counters ? achievementProgress(def, counters) : null;
        const progress = base && at ? { current: base.target, target: base.target } : base;
        return {
          code: def.code,
          name: def.name,
          description: def.description,
          family: def.family,
          tier: def.tier,
          icon: achievementIcon(def.family),
          earned: at !== null,
          earnedAt: at ? at.toISOString() : null,
          progress,
          rarityPct:
            activeStudents >= RARITY_MIN_ACTIVE_STUDENTS
              ? Math.round(((holders.get(def.code) ?? 0) / activeStudents) * 1000) / 10
              : null,
        };
      });
    const showcase = [...new Set((profile?.showcase ?? []).filter((c) => !!achievementDef(c)))];
    return {
      items,
      showcase,
      earnedCount: items.filter((i) => i.earned).length,
      totalCount: items.length,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // GET / POST /ranking/me/daily-checkin
  // ---------------------------------------------------------------------------------------------

  private async dailyStatusOf(student: Student, now: Date): Promise<DailyCheckinStatus> {
    const today = spDay(now);
    const week = weekStart(today);
    const month = seasonOfDay(today);
    const from = [week, addDaysToDay(today, -6), `${month}-01`].sort()[0];
    const rows = await this.prisma.dailyCheckin.findMany({
      where: { studentId: student.id, day: { gte: from, lte: today } },
      select: { day: true },
    });
    const days = new Set(rows.map((r) => r.day));
    const weekDays = [...days].filter((d) => d >= week).length;
    return {
      today,
      checkedInToday: days.has(today),
      weekDays,
      weekTarget: DAILY_WEEK_TARGET,
      weekDone: weekDays >= DAILY_WEEK_TARGET,
      monthDays: [...days].filter((d) => d.startsWith(`${month}-`)).length,
      monthCapDays: DAILY_MONTH_CAP_DAYS,
      last7: Array.from({ length: 7 }, (_, i) => addDaysToDay(today, i - 6)).map((day) => ({ day, done: days.has(day) })),
    };
  }

  async dailyStatus(user: AuthenticatedUser, studentId: number | undefined, now: Date = new Date()): Promise<DailyCheckinStatus> {
    return this.dailyStatusOf(await this.activeStudentOf(user, studentId), now);
  }

  /**
   * Check-in do dia: data SO do servidor (America/Sao_Paulo), 1 por aluno por dia (unique; concorrencia segura:
   * createMany skipDuplicates). Depois recalcula o ranking do aluno em segundo plano (os pontos sao DERIVADOS).
   */
  async dailyCheckin(user: AuthenticatedUser, studentId: number | undefined, now: Date = new Date()) {
    const student = await this.activeStudentOf(user, studentId);
    const today = spDay(now);
    const { count } = await this.prisma.dailyCheckin.createMany({
      data: [{ organizationId: student.organizationId, studentId: student.id, day: today }],
      skipDuplicates: true,
    });
    const created = count === 1;
    const status = await this.dailyStatusOf(student, now);
    if (created) this.ranking.queueSync(student.id);
    return {
      ...status,
      alreadyCheckedIn: !created,
      // derivePoints pontua os primeiros DAILY_MONTH_CAP_DAYS dias do mes; hoje e' o ultimo dia gravado do mes.
      pointsToday: created && status.monthDays <= DAILY_MONTH_CAP_DAYS ? POINTS.DAILY_CHECKIN : 0,
    };
  }
}
