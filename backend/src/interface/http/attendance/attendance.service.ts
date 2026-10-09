import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { civilDateRange } from '../../../shared/dates/date-range';
import { pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilTodayStart } from '../finance/finance.service';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
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
  present: boolean | null;
  justification: string | null;
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
  ) {}

  findAll(organizationId: number) {
    return this.prisma.attendance.findMany({
      where: { organizationId },
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
  async getRoster(organizationId: number, lessonId: number): Promise<RosterEntry[]> {
    const lesson = await this.assertLessonBelongsToOrganization(organizationId, lessonId);

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
        present: attendance ? attendance.present : null,
        justification: attendance?.justification ?? null,
      };
    });
  }

  /**
   * Registra a chamada em lote de uma aula. Faz upsert por (lessonId, studentId) — cada
   * entrada substitui o registro anterior daquele aluno naquela aula, se existir.
   */
  async markAttendance(
    organizationId: number,
    lessonId: number,
    entries: AttendanceEntryDto[],
  ): Promise<{ count: number }> {
    await this.assertLessonBelongsToOrganization(organizationId, lessonId);

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

    return { count: entries.length };
  }

  /** Nunca confiar em lessonId vindo da URL sem confirmar que pertence à organização do
   * usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertLessonBelongsToOrganization(organizationId: number, lessonId: number) {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, organizationId } });
    if (!lesson) {
      throw new NotFoundException('Aula não encontrada.');
    }
    return lesson;
  }
}
