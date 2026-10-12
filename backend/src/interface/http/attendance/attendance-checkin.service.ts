import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCheckinToken, peekCheckinToken, verifyCheckinToken } from '../../../shared/checkin/checkin-token';
import { isInsideWindow, lessonCheckinWindow } from '../../../shared/checkin/checkin-window';
import { formatCivilDateBR, formatInstantBR } from '../../../shared/dates/format-br';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { lessonScopeFilter, UnitScopeService } from '../../../shared/access/unit-scope';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentsService } from '../students/students.service';
import { EventCheckinSelfDto } from '../events/dto/event-checkin-self.dto';

/**
 * Check-in por QR em aulas: a equipe gera o token da aula (painel, tela cheia), o aluno escaneia/digita no app e
 * a presenca (Attendance.present = true) e gravada para ELE (ou dependente). Regras: token valido para o grupo, aula
 * ativa, dentro da janela (2h antes do inicio ate 2h depois do fim) e aluno matriculado (ClassStudent ACTIVE) na turma
 * da aula. Idempotente. Se o professor ja tinha marcado falta, o check-in a transforma em presenca (o aluno esta na aula).
 */
@Injectable()
export class AttendanceCheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async issueToken(organizationId: number, lessonId: number, requester: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(requester, organizationId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, organizationId, AND: [lessonScopeFilter(scope)] },
      include: { class: { select: { name: true } } },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    const token = buildCheckinToken('L', lesson.id, organizationId);
    const appUrl = frontendBaseUrl('APP');
    const qrDataUrl = await QRCode.toDataURL(appUrl ? `${appUrl}/checkin?token=${token}` : token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 640,
    });
    const window = lessonCheckinWindow(lesson.date, lesson.startTime, lesson.endTime);
    return {
      kind: 'LESSON' as const,
      id: lesson.id,
      title: lesson.class.name,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      token,
      qrDataUrl,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    };
  }

  async selfCheckin(organizationId: number, requester: AuthenticatedUser, dto: EventCheckinSelfDto, now: Date = new Date()) {
    const peek = peekCheckinToken(dto.token);
    if (!peek || peek.kind !== 'L') throw new BadRequestException('Código de check-in inválido para uma aula.');

    // Aula de outro grupo (ou inexistente) = 404, igual a qualquer outra rota; so depois a assinatura.
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: peek.id, organizationId },
      include: { class: { select: { name: true, status: true } } },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    if (!verifyCheckinToken(dto.token, organizationId)) {
      throw new BadRequestException('Código de check-in inválido para esta aula.');
    }
    if (lesson.status !== 'ACTIVE') throw new ConflictException('Esta aula foi cancelada.');

    const window = lessonCheckinWindow(lesson.date, lesson.startTime, lesson.endTime);
    if (!isInsideWindow(window, now)) {
      throw new ConflictException(
        now < window.opensAt
          ? `O check-in desta aula abre em ${formatInstantBR(window.opensAt)}.`
          : `O check-in desta aula encerrou em ${formatInstantBR(window.closesAt)}.`,
      );
    }

    const myStudents = (await this.studentsService.findMine(organizationId, requester.id)).filter(
      (s) => s.status === 'ACTIVE',
    );
    if (dto.studentId !== undefined && !myStudents.some((s) => s.id === dto.studentId)) {
      throw new ForbiddenException('Você só pode fazer check-in de si mesmo ou dos seus dependentes.');
    }
    const enrollments = await this.prisma.classStudent.findMany({
      where: {
        organizationId,
        classId: lesson.classId,
        status: 'ACTIVE',
        studentId: { in: (dto.studentId !== undefined ? myStudents.filter((s) => s.id === dto.studentId) : myStudents).map((s) => s.id) },
      },
      orderBy: { studentId: 'asc' },
    });
    if (enrollments.length === 0) {
      throw new ForbiddenException('Você não está matriculado na turma desta aula.');
    }
    if (enrollments.length > 1 && dto.studentId === undefined) {
      throw new BadRequestException('Mais de um aluno seu está nesta turma: informe studentId.');
    }
    const studentId = enrollments[0].studentId;

    const existing = await this.prisma.attendance.findUnique({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId } },
    });
    if (existing?.present) {
      return { lessonId: lesson.id, studentId, present: true, alreadyCheckedIn: true };
    }
    await this.prisma.attendance.upsert({
      where: { lessonId_studentId: { lessonId: lesson.id, studentId } },
      create: { organizationId, lessonId: lesson.id, studentId, present: true },
      update: { present: true, justification: null },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.LESSON_CHECKIN_SELF,
      entity: AuditEntity.LESSON,
      entityId: lesson.id,
      meta: { studentId, classId: lesson.classId, via: 'qr', hadAbsence: existing ? true : false },
    });
    await this.notifications.notifyStudents(organizationId, [studentId], {
      title: 'Presença registrada',
      body: `Check-in na aula de ${lesson.class.name} (${formatCivilDateBR(lesson.date)}).`,
      type: 'LESSON_CHECKIN',
    });
    return { lessonId: lesson.id, studentId, present: true, alreadyCheckedIn: false };
  }
}
