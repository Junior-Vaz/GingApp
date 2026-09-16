import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { AttendanceEntryDto } from './dto/mark-attendance.dto';

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

  /** "Minha frequência" — escopado aos alunos ligados ao usuário autenticado (mesmo padrão
   * de FinanceService.findMine), com o percentual dos últimos 30 dias já calculado. */
  async findMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return { records: [], last30dPercent: null };

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const studentIds = students.map((s) => s.id);

    const records = await this.prisma.attendance.findMany({
      where: { organizationId, studentId: { in: studentIds } },
      include: { lesson: { select: { date: true, classId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const recent = records.filter((r) => r.createdAt >= thirtyDaysAgo);
    const presentCount = recent.filter((r) => r.present).length;
    const last30dPercent = recent.length > 0 ? Math.round((presentCount / recent.length) * 100) : null;

    return { records, last30dPercent };
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
