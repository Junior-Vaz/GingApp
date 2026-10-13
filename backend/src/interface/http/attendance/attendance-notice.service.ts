import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatLessonWhenBR } from '../../../shared/dates/format-br';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export const ATTENDANCE_PRESENT_TYPE = 'ATTENDANCE_PRESENT';
export const ATTENDANCE_PRESENT_TITLE = 'Presença registrada';

/** "Maria Clara Souza" -> "Maria" (nome curto do aluno no aviso). */
function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Aviso "Presença registrada": quando um aluno passa a PRESENTE numa aula (chamada em lote ou check-in por QR) ele (se
 * tiver login) e os responsáveis com login recebem uma notificação in-app que vira push FCM/Web Push pelo
 * NotificationsService (SSOT; categoria "lessons", destino /frequencia). Regras:
 *  - desligável por grupo (Organization.attendanceNotifications, PATCH /organizations/me);
 *  - IDEMPOTENTE por (aula, aluno): a 1ª vez que o aluno fica presente grava uma linha em AttendanceNotice com
 *    INSERT ... ON CONFLICT DO NOTHING ... RETURNING — só quem INSERIU é avisado, então re-salvar a chamada, presente ->
 *    ausente -> presente, o QR depois da chamada ou duas requisições simultâneas nunca avisam duas vezes;
 *  - a linha é gravada MESMO com o aviso desligado (ligar depois não dispara avisos atrasados ao re-salvar aulas antigas);
 *  - nunca lança (efeito colateral: não derruba a chamada); lote com UM createMany, sem N+1.
 */
@Injectable()
export class AttendanceNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Avisa os alunos presentes (ids repetidos/inválidos são ignorados). Devolve quantas notificações foram gravadas. */
  async notifyPresent(organizationId: number, lessonId: number, presentStudentIds: number[]): Promise<number> {
    return this.notifications.safely('attendancePresent', async () => {
      const ids = [...new Set(presentStudentIds)];
      if (ids.length === 0) return 0;

      // 1) "reserva" atômica: só os (aula, aluno) INSERIDOS agora são novos; aluno de outro grupo nunca entra.
      const claimed = await this.prisma.$queryRaw<Array<{ studentId: number }>>(Prisma.sql`
        INSERT INTO "AttendanceNotice" ("organizationId", "lessonId", "studentId")
        SELECT ${organizationId}, ${lessonId}, st."id" FROM "Student" st
        WHERE st."organizationId" = ${organizationId} AND st."id" = ANY(${ids}::int[])
        ON CONFLICT ("lessonId", "studentId") DO NOTHING
        RETURNING "studentId"`);
      if (claimed.length === 0) return 0;

      // 2) grupo com o aviso desligado, aula, alunos e destinatários — em lote.
      const claimedIds = claimed.map((c) => c.studentId);
      const [org, lesson, students, byStudent] = await Promise.all([
        this.prisma.organization.findUnique({ where: { id: organizationId }, select: { attendanceNotifications: true } }),
        this.prisma.lesson.findFirst({
          where: { id: lessonId, organizationId },
          select: { date: true, startTime: true, class: { select: { name: true, startTime: true } } },
        }),
        this.prisma.student.findMany({
          where: { organizationId, id: { in: claimedIds }, status: 'ACTIVE' },
          select: { id: true, name: true, userId: true },
        }),
        this.notifications.userIdsByStudent(organizationId, claimedIds),
      ]);
      if (!org?.attendanceNotifications || !lesson) return 0;

      const when = formatLessonWhenBR(lesson.date, lesson.startTime ?? lesson.class.startTime);
      const items: Prisma.NotificationCreateManyInput[] = [];
      for (const student of students) {
        for (const userId of byStudent.get(student.id) ?? []) {
          const own = userId === student.userId;
          items.push({
            organizationId,
            userId,
            title: ATTENDANCE_PRESENT_TITLE,
            type: ATTENDANCE_PRESENT_TYPE,
            body: `${own ? 'Você' : shortName(student.name)} esteve presente em ${lesson.class.name} — ${when}`,
          });
        }
      }
      return items.length === 0 ? 0 : this.notifications.createMany(items);
    });
  }
}
