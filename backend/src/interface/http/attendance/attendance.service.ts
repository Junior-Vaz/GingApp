import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { civilDateRange } from '../../../shared/dates/date-range';
import { pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilTodayStart } from '../finance/finance.service';
import { timeToMinutes, isTimeOfDay } from '../../../shared/dates/time-of-day';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { lessonScopeFilter, monitorLessonFilter, UnitScopeService } from '../../../shared/access/unit-scope';
import { RankingService } from '../ranking/ranking.service';
import { StudentsService } from '../students/students.service';
import { ListMyAttendanceQueryDto } from './dto/list-my-attendance-query.dto';
import { AttendanceEntryDto } from './dto/mark-attendance.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Resultado de findMine: `total` vai no header X-Total-Count; o resto compõe o corpo. */
export interface MyAttendance {
  records: unknown[];
  total: number;
  last30dPercent: number | null;
  currentStreak: number;
}

export interface RosterEntry {
  studentId: number;
  studentName: string;
  /** Foto do aluno (Student.photo) ou null. */
  photo: string | null;
  present: boolean | null;
  justification: string | null;
}

export type QuickSessionStatus = 'UPCOMING' | 'ONGOING' | 'ENDED';

/** Uma aula de HOJE para a chamada rápida (GET /attendance/quick-sessions). */
export interface QuickSession {
  lessonId: number;
  classId: number;
  className: string;
  classPhoto: string | null;
  startTime: string | null;
  endTime: string | null;
  unitName: string | null;
  status: QuickSessionStatus;
  /** Alunos ATIVOS matriculados na turma (o roster da chamada). */
  studentsCount: number;
  /** Registros de presença/falta já lançados nesta aula. */
  markedCount: number;
}

/** "HH:MM" atual em America/Sao_Paulo (mesmo fuso do "hoje" civil usado nas aulas). */
function saoPauloMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/**
 * Frequencia registrada nas aulas.
 * Diferente do padrão CRUD item-a-item dos outros módulos: a frequência é registrada em
 * lote por aula (roster de chamada), PLANO_PROJETO.md §10.5.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly ranking: RankingService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lê/registra
   * chamada de aulas da sua unidade (unidade efetiva da aula = a dela ou a da turma). `user` omitido = sem
   * restrição. /attendance/me (findMine) não passa por aqui: o escopo dela é o vínculo do aluno.
   */
  async findAll(organizationId: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    return this.prisma.attendance.findMany({
      where: { organizationId, lesson: { AND: [lessonScopeFilter(scope), monitorLessonFilter(user)] } },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /**
   * "Minha frequência" — escopado aos alunos ligados ao usuário autenticado (mesmo padrão de
   * FinanceService.findMine). `records` é paginado (limit/offset) e filtrável pela data da AULA
   * (from/to), mais recente primeiro; `total` é o nº de registros que casam com o filtro. Os
   * indicadores (last30dPercent, currentStreak) são calculados por AGREGAÇÃO no banco sobre TODO o
   * histórico do escopo — nunca sobre a página devolvida.
   *
   * last30dPercent = presenças / registros das aulas dos últimos 30 dias civis (hoje em
   * America/Sao_Paulo e os 29 anteriores); null sem registros. currentStreak = presenças seguidas,
   * da aula mais recente para trás, até a primeira falta (desempate de mesma data: maior id).
   */
  async findMine(
    organizationId: number,
    userId: number,
    query: ListMyAttendanceQueryDto = {},
    now: Date = new Date(),
  ): Promise<MyAttendance> {
    let studentIds: number[];
    if (query.studentId !== undefined) {
      await requireLinkedStudent(this.studentsService, organizationId, userId, query.studentId);
      studentIds = [query.studentId];
    } else {
      studentIds = (await this.studentsService.findMine(organizationId, userId)).map((s) => s.id);
    }
    if (studentIds.length === 0) return { records: [], total: 0, last30dPercent: null, currentStreak: 0 };

    const scope: Prisma.AttendanceWhereInput = { organizationId, studentId: { in: studentIds } };
    const lessonDate = civilDateRange(query.from, query.to);
    const where: Prisma.AttendanceWhereInput = { ...scope, ...(lessonDate ? { lesson: { date: lessonDate } } : {}) };
    const order: Prisma.AttendanceOrderByWithRelationInput[] = [{ lesson: { date: 'desc' } }, { id: 'desc' }];

    const since = new Date(civilTodayStart(now).getTime() - 29 * DAY_MS);
    const last30d: Prisma.AttendanceWhereInput = { ...scope, lesson: { date: { gte: since } } };

    const [records, total, last30dTotal, last30dPresent, firstAbsent] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        include: { lesson: { select: { date: true, classId: true } } },
        orderBy: order,
        ...pageArgs(query),
      }),
      this.prisma.attendance.count({ where }),
      this.prisma.attendance.count({ where: last30d }),
      this.prisma.attendance.count({ where: { ...last30d, present: true } }),
      this.prisma.attendance.findFirst({
        where: { ...scope, present: false },
        select: { id: true, lesson: { select: { date: true } } },
        orderBy: order,
      }),
    ]);

    // Tudo que vem ANTES da falta mais recente (data maior, ou mesma data e id maior) é presença.
    const currentStreak = await this.prisma.attendance.count({
      where: firstAbsent
        ? {
            ...scope,
            OR: [
              { lesson: { date: { gt: firstAbsent.lesson.date } } },
              { lesson: { date: firstAbsent.lesson.date }, id: { gt: firstAbsent.id } },
            ],
          }
        : scope,
    });

    return {
      records,
      total,
      last30dPercent: last30dTotal > 0 ? Math.round((last30dPresent / last30dTotal) * 100) : null,
      currentStreak,
    };
  }

  /**
   * Monta a lista de chamada de uma aula: todos os alunos ACTIVE matriculados na turma
   * daquela aula, com o registro de Attendance já existente (se houver). `present: null`
   * indica que a chamada ainda não foi feita para aquele aluno nessa aula.
   */
  async getRoster(organizationId: number, lessonId: number, user?: AuthenticatedUser): Promise<RosterEntry[]> {
    const lesson = await this.assertLessonBelongsToOrganization(organizationId, lessonId, user);

    const [classStudents, attendances] = await Promise.all([
      this.prisma.classStudent.findMany({
        where: { organizationId, classId: lesson.classId, status: 'ACTIVE' },
        include: { student: true },
        orderBy: { student: { name: 'asc' } },
      }),
      this.prisma.attendance.findMany({
        where: { organizationId, lessonId },
      }),
    ]);

    const attendanceByStudentId = new Map(attendances.map((a) => [a.studentId, a]));

    return classStudents.map((cs) => {
      const attendance = attendanceByStudentId.get(cs.studentId);
      return {
        studentId: cs.studentId,
        studentName: cs.student.name,
        photo: cs.student.photo,
        present: attendance ? attendance.present : null,
        justification: attendance?.justification ?? null,
      };
    });
  }

  /**
   * Chamada rápida (botão flutuante do painel): as aulas de HOJE (data civil de America/Sao_Paulo) da organização
   * visíveis ao usuário (escopo de unidade, igual a /attendance/lessons/:id), só aulas ATIVAS de turmas ATIVAS.
   * `status` pelo horário atual de São Paulo: ENDED (já passou do fim), UPCOMING (ainda não começou) ou ONGOING
   * (entre início e fim; aula sem horário conta como ONGOING o dia todo). Ordem: ONGOING, UPCOMING, ENDED —
   * dentro de cada grupo por horário de início (sem horário por último). O horário da aula cai no da turma se nulo.
   * Contagens em lote (sem N+1): studentsCount = matrículas ACTIVE da turma; markedCount = presenças lançadas na aula.
   */
  async quickSessions(organizationId: number, user?: AuthenticatedUser, now: Date = new Date()): Promise<QuickSession[]> {
    const scope = await this.unitScope.resolve(user, organizationId);
    const today = civilTodayStart(now);
    const lessons = await this.prisma.lesson.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        date: { gte: today, lt: new Date(today.getTime() + DAY_MS) },
        class: { status: 'ACTIVE' },
        AND: [lessonScopeFilter(scope), monitorLessonFilter(user)],
      },
      include: {
        class: { select: { id: true, name: true, photo: true, startTime: true, endTime: true, unit: { select: { name: true } } } },
        unit: { select: { name: true } },
      },
    });
    if (lessons.length === 0) return [];

    const classIds = [...new Set(lessons.map((l) => l.classId))];
    const [enrolled, marked] = await Promise.all([
      this.prisma.classStudent.groupBy({
        by: ['classId'],
        where: { organizationId, classId: { in: classIds }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['lessonId'],
        where: { organizationId, lessonId: { in: lessons.map((l) => l.id) } },
        _count: { _all: true },
      }),
    ]);
    const studentsByClass = new Map(enrolled.map((e) => [e.classId, e._count._all]));
    const markedByLesson = new Map(marked.map((m) => [m.lessonId, m._count._all]));

    const nowMinutes = saoPauloMinutes(now);
    const rank: Record<QuickSessionStatus, number> = { ONGOING: 0, UPCOMING: 1, ENDED: 2 };
    const sessions = lessons.map((lesson): QuickSession => {
      const startTime = lesson.startTime ?? lesson.class.startTime;
      const endTime = lesson.endTime ?? lesson.class.endTime;
      let status: QuickSessionStatus = 'ONGOING';
      if (isTimeOfDay(endTime) && nowMinutes >= timeToMinutes(endTime)) status = 'ENDED';
      else if (isTimeOfDay(startTime) && nowMinutes < timeToMinutes(startTime)) status = 'UPCOMING';
      return {
        lessonId: lesson.id,
        classId: lesson.classId,
        className: lesson.class.name,
        classPhoto: lesson.class.photo,
        startTime,
        endTime,
        unitName: lesson.unit?.name ?? lesson.class.unit?.name ?? null,
        status,
        studentsCount: studentsByClass.get(lesson.classId) ?? 0,
        markedCount: markedByLesson.get(lesson.id) ?? 0,
      };
    });
    return sessions.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
        a.lessonId - b.lessonId,
    );
  }

  /**
   * Registra a chamada em lote de uma aula. Faz upsert por (lessonId, studentId) — cada
   * entrada substitui o registro anterior daquele aluno naquela aula, se existir.
   */
  async markAttendance(
    organizationId: number,
    lessonId: number,
    entries: AttendanceEntryDto[],
    user?: AuthenticatedUser,
  ): Promise<{ count: number }> {
    await this.assertLessonBelongsToOrganization(organizationId, lessonId, user);

    if (entries.length === 0) {
      return { count: 0 };
    }

    // Nunca confiar cegamente nos studentId do corpo da requisição — mesmo vindo do roster
    // real, um corpo malicioso poderia incluir studentId de outra organização
    // (PLANO_PROJETO.md §3.2 item 4).
    const studentIds = [...new Set(entries.map((e) => e.studentId))];
    const validStudents = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, organizationId },
      select: { id: true },
    });
    const validStudentIds = new Set(validStudents.map((s) => s.id));

    const invalidEntry = entries.find((e) => !validStudentIds.has(e.studentId));
    if (invalidEntry) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }

    await this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.attendance.upsert({
          where: { lessonId_studentId: { lessonId, studentId: entry.studentId } },
          create: {
            organizationId,
            lessonId,
            studentId: entry.studentId,
            present: entry.present,
            justification: entry.justification,
          },
          update: {
            present: entry.present,
            justification: entry.justification,
          },
        }),
      ),
    );

    // Ginga Rank: recalcula os pontos dos alunos da chamada (fire-and-forget: nunca atrasa nem derruba a chamada).
    this.ranking.queueSync(studentIds);

    return { count: entries.length };
  }

  /** Nunca confiar em lessonId vindo da URL sem confirmar que pertence à organização do
   * usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertLessonBelongsToOrganization(organizationId: number, lessonId: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, organizationId, AND: [lessonScopeFilter(scope), monitorLessonFilter(user)] },
    });
    if (!lesson) {
      throw new NotFoundException('Aula não encontrada.');
    }
    return lesson;
  }
}
