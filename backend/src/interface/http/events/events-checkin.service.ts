import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { ParticipantStatus } from '@prisma/client';
import * as QRCode from 'qrcode';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { buildCheckinToken, verifyCheckinToken } from '../../../shared/checkin/checkin-token';
import { eventCheckinWindow, isInsideWindow } from '../../../shared/checkin/checkin-window';
import { formatInstantBR } from '../../../shared/dates/format-br';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { frontendBaseUrl } from '../../../shared/mail/mail.config';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RankingService } from '../ranking/ranking.service';
import { StudentsService } from '../students/students.service';
import { EventsService } from './events.service';
import { EventCheckinSelfDto } from './dto/event-checkin-self.dto';

/**
 * Check-in por QR em eventos. A EQUIPE gera o token (GET /events/:id/checkin-token, exibido como QR em tela cheia no
 * painel); o ALUNO (ou responsavel, por um dependente) le o QR / digita o codigo e chama POST /events/:id/checkin-self.
 * Regras: token valido para este evento e grupo, evento nao cancelado, dentro da janela (2h antes ate 6h depois do
 * inicio) e aluno JA inscrito (confirmado/convidado) — lista de espera nao entra. Idempotente: repetir devolve
 * `alreadyCheckedIn: true` sem tocar na inscricao.
 */
@Injectable()
export class EventsCheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
  ) {}

  /** Token + QR (data URL PNG) do evento, para a equipe imprimir/exibir. 404 se o evento nao e do grupo/escopo. */
  async issueToken(organizationId: number, eventId: number, requester: AuthenticatedUser) {
    const event = await this.events.findOne(organizationId, eventId, requester);
    const token = buildCheckinToken('E', event.id, organizationId);
    const appUrl = frontendBaseUrl('APP');
    const qrDataUrl = await QRCode.toDataURL(appUrl ? `${appUrl}/checkin?token=${token}` : token, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 640,
    });
    const window = eventCheckinWindow(event.date);
    return {
      kind: 'EVENT' as const,
      id: event.id,
      title: event.title,
      date: event.date,
      token,
      qrDataUrl,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    };
  }

  async checkinSelf(
    organizationId: number,
    eventId: number,
    requester: AuthenticatedUser,
    dto: EventCheckinSelfDto,
    now: Date = new Date(),
  ) {
    const event = await this.events.findOne(organizationId, eventId, requester); // 404: outro grupo / inexistente / rascunho

    const verified = verifyCheckinToken(dto.token, organizationId);
    if (!verified || verified.kind !== 'E' || verified.id !== event.id) {
      throw new BadRequestException('Código de check-in inválido para este evento.');
    }
    if (event.status === 'CANCELLED') throw new ConflictException('Este evento foi cancelado.');

    const window = eventCheckinWindow(event.date);
    if (!isInsideWindow(window, now)) {
      throw new ConflictException(
        now < window.opensAt
          ? `O check-in abre em ${formatInstantBR(window.opensAt)}.`
          : `O check-in deste evento encerrou em ${formatInstantBR(window.closesAt)}.`,
      );
    }

    const myStudents = (await this.studentsService.findMine(organizationId, requester.id)).filter(
      (s) => s.status === 'ACTIVE',
    );
    if (dto.studentId !== undefined && !myStudents.some((s) => s.id === dto.studentId)) {
      throw new ForbiddenException('Você só pode fazer check-in de si mesmo ou dos seus dependentes.');
    }
    const candidates = dto.studentId !== undefined ? myStudents.filter((s) => s.id === dto.studentId) : myStudents;
    const enrolled = await this.prisma.eventParticipant.findMany({
      where: { organizationId, eventId, studentId: { in: candidates.map((s) => s.id) } },
      orderBy: { id: 'asc' },
    });
    if (enrolled.length === 0) {
      throw new ForbiddenException('Você não está inscrito neste evento. Inscreva-se antes de fazer o check-in.');
    }
    if (enrolled.length > 1 && dto.studentId === undefined) {
      throw new BadRequestException('Mais de um aluno seu está inscrito: informe studentId.');
    }
    const participant = enrolled[0];

    if (participant.status === ParticipantStatus.ATTENDED) {
      return { participantId: participant.id, studentId: participant.studentId, status: participant.status, alreadyCheckedIn: true };
    }
    if (participant.status === ParticipantStatus.WAITLIST) {
      throw new ConflictException('Você está na lista de espera deste evento: o check-in só vale para inscrição confirmada.');
    }
    if (participant.status !== ParticipantStatus.CONFIRMED && participant.status !== ParticipantStatus.INVITED) {
      throw new ForbiddenException('Sua inscrição neste evento não está ativa.');
    }

    await this.prisma.eventParticipant.update({ where: { id: participant.id }, data: { status: ParticipantStatus.ATTENDED } });
    this.ranking.queueSync(participant.studentId); // Ginga Rank (fire-and-forget)
    await this.audit.record({
      organizationId,
      action: AuditAction.EVENT_CHECKIN_SELF,
      entity: AuditEntity.EVENT,
      entityId: event.id,
      meta: { participantId: participant.id, studentId: participant.studentId, via: 'qr' },
    });
    if (participant.studentId) {
      await this.notifications.notifyStudents(organizationId, [participant.studentId], {
        title: 'Presença confirmada',
        body: `Check-in feito em ${event.title} — ${formatInstantBR(now)}.`,
        type: 'EVENT_CHECKIN',
      });
    }
    return { participantId: participant.id, studentId: participant.studentId, status: ParticipantStatus.ATTENDED, alreadyCheckedIn: false };
  }
}
