import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { OrgRole, ParticipantStatus, Prisma, StudentStatus } from '@prisma/client';
import { MailService } from '../../../shared/mail/mail.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isFull, OCCUPYING_STATUSES } from '../events/event-registration';
import { NotificationsService } from '../notifications/notifications.service';
import { FormErrorCode, validationError } from './form-codes';
import { publicFormUrl } from './form-common';

/** Janela do agrupamento do aviso ao Mestre: no maximo 1 aviso por formulario neste intervalo. */
export const MESTRE_NOTIFY_WINDOW_MS = 5 * 60_000;

export type ApplicantNotice = 'RECEIVED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'WAITLIST';

type Tx = Prisma.TransactionClient;

const intEnv = (name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** E-mails de aviso disparados por ENVIO ANONIMO para o mesmo endereco (chave normalizada), em 24 h (padrao 3). */
export function formsMailPerRecipientDaily(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv('FORMS_MAIL_PER_RECIPIENT_DAILY', 3, env);
}
/** E-mails de aviso disparados por envio anonimo num MESMO formulario, por hora (padrao 100). */
export function formsMailFormHourlyMax(env: NodeJS.ProcessEnv = process.env): number {
  return intEnv('FORMS_MAIL_FORM_HOURLY_MAX', 100, env);
}

/** 409 (codigo ja conhecido do painel) quando o EVENTO ligado nao tem mais vaga para confirmar alguem. */
export function eventFullForForm(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: FormErrorCode.FORM_FULL,
    message: 'O evento ligado a este formulário está lotado: aumente as vagas do evento ou mova a inscrição para a lista de espera.',
  });
}

export interface ParticipantSubmission {
  id: number;
  organizationId: number;
  name: string;
  studentId: number | null;
  eventParticipantId: number | null;
}

/**
 * Efeitos colaterais de uma inscricao, reaproveitados pelo envio publico e pela gestao no painel:
 *  - participante do evento (EventParticipant) ao CONFIRMAR, respeitando Event.capacity / removido ao sair da
 *    confirmacao. O envio ANONIMO nunca liga a ficha de um aluno nem altera uma participacao que ja existia: o aluno
 *    com o mesmo CPF vira so SUGESTAO (suggestedStudentId); o vinculo e acao do MESTRE (linkStudentId);
 *  - aviso ao Mestre (NotificationsService, SSOT do sino/push) SEM dado pessoal, agrupado por formulario;
 *  - e-mail curto ao inscrito (MailService), so protocolo + titulo + situacao, com teto por destinatario e por formulario
 *    quando quem dispara e o envio anonimo.
 * Falha de aviso/e-mail nunca derruba a acao principal.
 */
@Injectable()
export class RegistrationEffectsService {
  private readonly logger = new Logger(RegistrationEffectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  /** Cabe mais um CONFIRMED no evento? Trava a linha do evento (mesma secao critica de EventsService). */
  async eventHasRoom(tx: Tx, eventId: number): Promise<boolean> {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { capacity: true } });
    if (!event || event.capacity == null) return true;
    const occupied = await tx.eventParticipant.count({ where: { eventId, status: { in: OCCUPYING_STATUSES } } });
    return !isFull(event.capacity, occupied);
  }

  /**
   * Garante o participante do evento para a inscricao que acabou de ser CONFIRMADA (idempotente). Regras:
   *  - participante que ESTA inscricao criou: confirmado de novo se houver vaga (senao 409 de evento lotado);
   *  - aluno ligado pelo Mestre (submission.studentId) que ja participa do evento: a participacao existente NUNCA e
   *    alterada (lista de espera/recusa continuam sendo decisao da pagina do evento) e o id nao e guardado;
   *  - senao cria UM participante CONFIRMED (aluno ligado ou convidado com o nome), so se o evento tiver vaga.
   * Devolve o id do participante (ou null se o formulario nao tem evento).
   */
  async ensureParticipant(tx: Tx, submission: ParticipantSubmission, eventId: number | null): Promise<number | null> {
    if (!eventId) return null;
    if (submission.eventParticipantId) {
      const current = await tx.eventParticipant.findFirst({
        where: { id: submission.eventParticipantId, eventId, organizationId: submission.organizationId },
      });
      if (current) {
        if (current.status === ParticipantStatus.ATTENDED || current.status === ParticipantStatus.CONFIRMED) return current.id;
        if (!(await this.eventHasRoom(tx, eventId))) throw eventFullForForm();
        await tx.eventParticipant.update({ where: { id: current.id }, data: { status: ParticipantStatus.CONFIRMED } });
        return current.id;
      }
    }
    const studentId = submission.studentId;
    if (studentId) {
      const existing = await tx.eventParticipant.findFirst({
        where: { organizationId: submission.organizationId, eventId, studentId },
        orderBy: { id: 'asc' },
      });
      if (existing) return existing.id;
    }
    if (!(await this.eventHasRoom(tx, eventId))) throw eventFullForForm();
    const created = await tx.eventParticipant.create({
      data: {
        organizationId: submission.organizationId,
        eventId,
        studentId: studentId ?? undefined,
        guestName: studentId ? undefined : submission.name.slice(0, 200),
        status: ParticipantStatus.CONFIRMED,
      },
    });
    await tx.registrationSubmission.update({ where: { id: submission.id }, data: { eventParticipantId: created.id } });
    return created.id;
  }

  /**
   * Vinculo com a ficha feito pelo MESTRE (linkStudentId): o aluno precisa ser deste grupo. Liga a inscricao e, se ela
   * ja tem o participante de CONVIDADO que ela mesma criou, troca-o pelo aluno (ou remove a duplicata quando o aluno ja
   * participa do evento por outro caminho - a participacao dele nao muda).
   */
  async linkStudent(tx: Tx, submission: ParticipantSubmission, eventId: number | null, studentId: number): Promise<ParticipantSubmission> {
    const student = await tx.student.findFirst({ where: { id: studentId, organizationId: submission.organizationId }, select: { id: true } });
    if (!student) throw validationError({ linkStudentId: 'Aluno não encontrado neste grupo.' });
    let eventParticipantId = submission.eventParticipantId;
    if (eventId && eventParticipantId) {
      const own = await tx.eventParticipant.findFirst({ where: { id: eventParticipantId, eventId, organizationId: submission.organizationId } });
      if (own && own.studentId !== studentId) {
        const other = await tx.eventParticipant.findFirst({
          where: { organizationId: submission.organizationId, eventId, studentId, id: { not: own.id } },
          select: { id: true },
        });
        if (other) {
          if (own.status !== ParticipantStatus.ATTENDED) await tx.eventParticipant.delete({ where: { id: own.id } });
          eventParticipantId = null;
        } else {
          await tx.eventParticipant.update({ where: { id: own.id }, data: { studentId, guestName: null } });
        }
      }
    }
    await tx.registrationSubmission.update({ where: { id: submission.id }, data: { studentId, eventParticipantId } });
    return { ...submission, studentId, eventParticipantId };
  }

  /** Inscricao saiu da confirmacao (recusada/cancelada/lista de espera): remove o participante (presenca registrada fica). */
  async releaseParticipant(tx: Tx, submission: { id: number; organizationId: number; eventParticipantId: number | null }): Promise<void> {
    if (!submission.eventParticipantId) return;
    const participant = await tx.eventParticipant.findFirst({
      where: { id: submission.eventParticipantId, organizationId: submission.organizationId },
    });
    if (participant && participant.status !== ParticipantStatus.ATTENDED) {
      await tx.eventParticipant.delete({ where: { id: participant.id } });
    }
    await tx.registrationSubmission.update({ where: { id: submission.id }, data: { eventParticipantId: null } });
  }

  /** Aluno ATIVO do grupo com o mesmo CPF (Person.documentHash, seguindo mesclas). So SUGESTAO para o Mestre. */
  async matchStudent(tx: Tx, organizationId: number, documentHash: string | null): Promise<number | null> {
    if (!documentHash) return null;
    let person = await tx.person.findUnique({ where: { documentHash }, select: { id: true, mergedIntoId: true } });
    for (let i = 0; person?.mergedIntoId && i < 5; i++) {
      person = await tx.person.findUnique({ where: { id: person.mergedIntoId }, select: { id: true, mergedIntoId: true } });
    }
    if (!person) return null;
    const student = await tx.student.findFirst({
      where: { organizationId, personId: person.id, status: StudentStatus.ACTIVE },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return student?.id ?? null;
  }

  /**
   * Decide (dentro da transacao do envio, com a linha do formulario TRAVADA) se este envio gera aviso agora. Primeira
   * inscricao avisa na hora; as seguintes dentro da janela so somam no contador e saem no proximo aviso. Devolve
   * quantas inscricoes o aviso deve contar (0 = nao avisar agora).
   */
  async bumpMestreNotice(tx: Tx, form: { id: number; lastNotifiedAt: Date | null; pendingNotifyCount: number }, now: Date): Promise<number> {
    const pending = form.pendingNotifyCount + 1;
    if (form.lastNotifiedAt && now.getTime() - form.lastNotifiedAt.getTime() < MESTRE_NOTIFY_WINDOW_MS) {
      await tx.registrationForm.update({ where: { id: form.id }, data: { pendingNotifyCount: pending } });
      return 0;
    }
    await tx.registrationForm.update({ where: { id: form.id }, data: { pendingNotifyCount: 0, lastNotifiedAt: now } });
    return pending;
  }

  /** Aviso (sino/push) aos MESTRES ativos do grupo: so o titulo do formulario e a contagem, nunca dado do inscrito. */
  async notifyMestres(organizationId: number, formTitle: string, count: number): Promise<void> {
    if (count <= 0) return;
    await this.notifications.safely('registrationSubmission', async () => {
      const mestres = await this.prisma.organizationUser.findMany({
        where: { organizationId, role: OrgRole.MESTRE, status: 'ACTIVE' },
        select: { userId: true },
      });
      return this.notifications.notifyUsers(
        organizationId,
        mestres.map((m) => m.userId),
        {
          title: count > 1 ? `${count} novas inscrições` : 'Nova inscrição',
          body: count > 1 ? `${count} novas inscrições em ${formTitle}.` : `Nova inscrição em ${formTitle}.`,
          type: 'REGISTRATION_SUBMISSION',
        },
      );
    });
  }

  /**
   * E-mail curto ao inscrito (so protocolo, titulo do formulario e situacao; NUNCA texto do inscrito). Silencioso sem
   * SMTP ou sem e-mail. Disparo do ENVIO ANONIMO (`source: 'public'`) tem teto: por destinatario (chave normalizada,
   * inscricoes das ultimas 24 h em QUALQUER formulario, FORMS_MAIL_PER_RECIPIENT_DAILY) e por formulario/hora
   * (FORMS_MAIL_FORM_HOURLY_MAX) - contados nas proprias inscricoes (persistente, vale entre instancias). Acima do teto
   * o aviso nao sai (a pessoa ve o protocolo na tela). Acao do Mestre no painel (`source: 'admin'`) sempre avisa.
   * Devolve true se o envio foi disparado.
   */
  async notifyApplicant(
    email: string | null,
    notice: ApplicantNotice,
    input: { formTitle: string; protocol: string; slug: string },
    limit: { source: 'admin' } | { source: 'public'; formId: number; emailKey: string | null; now: Date } = { source: 'admin' },
  ): Promise<boolean> {
    if (!email || !this.mail.isEnabled()) return false;
    try {
      if (limit.source === 'public') {
        const dayAgo = new Date(limit.now.getTime() - 24 * 3600_000);
        const hourAgo = new Date(limit.now.getTime() - 3600_000);
        const [toRecipient, inForm] = await Promise.all([
          limit.emailKey ? this.prisma.registrationSubmission.count({ where: { emailKey: limit.emailKey, createdAt: { gte: dayAgo } } }) : Promise.resolve(0),
          this.prisma.registrationSubmission.count({ where: { formId: limit.formId, email: { not: null }, createdAt: { gte: hourAgo } } }),
        ]);
        if (toRecipient > formsMailPerRecipientDaily() || inForm > formsMailFormHourlyMax()) {
          this.logger.warn('Aviso de inscrição por e-mail não enviado: teto por destinatário/formulário atingido.');
          return false;
        }
      }
    } catch {
      return false;
    }
    void this.mail
      .sendRegistrationNotice({ to: email, notice, formTitle: input.formTitle, protocol: input.protocol, link: publicFormUrl(input.slug) })
      .catch(() => this.logger.warn('Falha ao enviar o aviso da inscrição por e-mail.'));
    return true;
  }
}
