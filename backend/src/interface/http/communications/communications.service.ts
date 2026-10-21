import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AckRequirement,
  AckResponse,
  Announcement,
  CommunicationScope,
  CommunicationStatus,
  OrgRole,
  Prisma,
} from '@prisma/client';
import { assertUnitTarget, UnitScopeService } from '../../../shared/access/unit-scope';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { announcementAudienceUserIds } from '../announcements/announcement-audience';
import { QuickSendService } from '../announcements/quick-send.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isMinor } from '../ranking/ranking-rules';
import { safeBannerUrl } from '../registration-forms/form-common';
import { todayCivil } from '../reports/report-period';
import {
  CommunicationRole,
  CreateCommunicationDto,
  ListCommunicationsQueryDto,
} from './dto/communications.dto';

/** Notification.type das mensagens do Comunicar (o app abre a confirmacao por `data.communicationId`). */
export const COMMUNICATION_NOTIFICATION_TYPE = 'COMMUNICATION';
/** Acima deste numero de destinatarios o envio exige `confirmCount` igual a contagem atual. */
export const COMMUNICATION_CONFIRM_THRESHOLD = 50;
/** Agendamento: no maximo 90 dias a frente. */
export const COMMUNICATION_MAX_SCHEDULE_DAYS = 90;
/** Reenvio aos nao lidos: no maximo 1 a cada 24 h. */
export const COMMUNICATION_RESEND_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Namespace do advisory lock da cota diaria (par com o id do grupo): serializa criacoes concorrentes do mesmo grupo. */
const QUOTA_LOCK_NS = 7301;
/** Quantos agendados vencidos cada rodada do agendador processa (o resto fica para o proximo minuto). */
const SCHEDULER_BATCH = 100;
const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export const NO_RECIPIENTS_CODE = 'NO_RECIPIENTS';
export const RECIPIENTS_CHANGED_CODE = 'RECIPIENTS_CHANGED';
export const COMM_QUOTA_EXCEEDED_CODE = 'COMM_QUOTA_EXCEEDED';
export const RESEND_TOO_SOON_CODE = 'RESEND_TOO_SOON';
export const ALREADY_SENT_CODE = 'ALREADY_SENT';
export const NOT_SENT_CODE = 'NOT_SENT';
export const NOT_RECIPIENT_CODE = 'NOT_RECIPIENT';
export const ACK_NOT_ALLOWED_CODE = 'ACK_NOT_ALLOWED';

/** Equipe do contrato (secao 1): MESTRE, PROFESSOR, INSTRUTOR (MONITOR conta como membro). */
const STAFF_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR, OrgRole.INSTRUTOR];
const COMM_ROLES: readonly string[] = ['ALUNO', 'RESPONSAVEL', 'EQUIPE'];

export interface ScopeInput {
  type: CommunicationScope;
  unitId?: number | null;
  classId?: number | null;
  role?: string | null;
}

/** Alcance ja validado e autorizado. */
interface Reach {
  scopeType: CommunicationScope;
  unitId: number | null;
  classId: number | null;
  role: CommunicationRole | null;
}

interface RowStats {
  readCount: number;
  acks: { READ: number; GOING: number; NOT_GOING: number };
}

type CommunicationRow = Announcement & {
  createdByUser?: { name: string } | null;
  unit?: { name: string } | null;
  class?: { name: string } | null;
};

function apiError(status: number, error: string, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { statusCode: status, error, code, message, ...extra };
}
const tooMany = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException(apiError(429, 'Too Many Requests', code, message, extra), HttpStatus.TOO_MANY_REQUESTS);

function limitFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Meia-noite (America/Sao_Paulo, UTC-3 fixo: o Brasil nao tem horario de verao desde 2019) do dia civil de `now`. */
export function startOfCivilDaySaoPaulo(now: Date): Date {
  return new Date(`${todayCivil(now)}T00:00:00-03:00`);
}

/**
 * Comunicar (contrato `docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md` secao 3), sobre `Announcement` + `Notification`.
 * SSOT reaproveitado: destinatarios por `announcementAudienceUserIds`/`NotificationsService.audienceUserIds`,
 * gravacao por `NotificationsService.createMany` (dentro da MESMA transacao do comunicado, push so depois do commit),
 * filtro de inativos por `QuickSendService.activeOnly`, escopo de unidade por `UnitScopeService`.
 *
 * - Alcance GROUP/UNIT/ROLE/BIRTHDAY_MONTH so MESTRE; CLASS tambem PROFESSOR/INSTRUTOR nas PROPRIAS turmas.
 * - Historico: MESTRE ve tudo; os demais so os seus.
 * - "Lidos" = usuarios distintos com notificacao lida (readAt) OU que confirmaram (ack): confirmar implica ter lido.
 * - Destinatario de um fixado/ack: quem recebeu a notificacao (alcance no envio) ou, no alcance GROUP, qualquer membro.
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly quickSend: QuickSendService,
    private readonly permissions: PermissionsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // ALCANCE
  // ---------------------------------------------------------------------------------------------

  private isMestre(user: AuthenticatedUser): boolean {
    return user.role === OrgRole.MESTRE || this.permissions.isPlatform(user);
  }

  /** Valida os campos exigidos por cada tipo de alcance e a permissao do autor para ele. */
  private async resolveReach(organizationId: number, user: AuthenticatedUser, scope: ScopeInput): Promise<Reach> {
    const mestre = this.isMestre(user);
    const onlyMestre = () => {
      if (!mestre) throw new ForbiddenException('Apenas o Mestre pode enviar para este alcance.');
    };
    switch (scope.type) {
      case CommunicationScope.GROUP:
      case CommunicationScope.BIRTHDAY_MONTH:
        onlyMestre();
        return { scopeType: scope.type, unitId: null, classId: null, role: null };
      case CommunicationScope.UNIT: {
        onlyMestre();
        if (scope.unitId == null) throw new BadRequestException('Informe a unidade (scope.unitId).');
        const unit = await this.prisma.unit.findFirst({ where: { id: scope.unitId, organizationId }, select: { id: true } });
        if (!unit) throw new BadRequestException('Unidade inválida para esta organização.');
        return { scopeType: scope.type, unitId: unit.id, classId: null, role: null };
      }
      case CommunicationScope.ROLE: {
        onlyMestre();
        if (!scope.role || !COMM_ROLES.includes(scope.role)) {
          throw new BadRequestException('Informe o papel (scope.role): ALUNO, RESPONSAVEL ou EQUIPE.');
        }
        return { scopeType: scope.type, unitId: null, classId: null, role: scope.role as CommunicationRole };
      }
      case CommunicationScope.CLASS: {
        if (scope.classId == null) throw new BadRequestException('Informe a turma (scope.classId).');
        const klass = await this.prisma.class.findFirst({
          where: { id: scope.classId, organizationId },
          select: { id: true, unitId: true, teacherUserId: true },
        });
        if (!klass) throw new BadRequestException('Turma inválida para esta organização.');
        if (!mestre) {
          assertUnitTarget(await this.unitScope.resolve(user, organizationId), klass.unitId);
          const own =
            klass.teacherUserId === user.id ||
            (await this.prisma.lesson.count({ where: { organizationId, classId: klass.id, teacherUserId: user.id } })) > 0;
          if (!own) throw new ForbiddenException('Você só pode enviar para as suas turmas.');
        }
        return { scopeType: scope.type, unitId: null, classId: klass.id, role: null };
      }
    }
  }

  /** Reconstroi o alcance de um comunicado JA gravado; null quando ficou invalido (turma/unidade apagada). */
  private reachOf(row: Announcement): Reach | null {
    switch (row.scopeType) {
      case CommunicationScope.GROUP:
      case CommunicationScope.BIRTHDAY_MONTH:
        return { scopeType: row.scopeType, unitId: null, classId: null, role: null };
      case CommunicationScope.UNIT:
        return row.unitId == null ? null : { scopeType: row.scopeType, unitId: row.unitId, classId: null, role: null };
      case CommunicationScope.CLASS:
        return row.classId == null ? null : { scopeType: row.scopeType, unitId: null, classId: row.classId, role: null };
      case CommunicationScope.ROLE:
        return row.scopeRole && COMM_ROLES.includes(row.scopeRole)
          ? { scopeType: row.scopeType, unitId: null, classId: null, role: row.scopeRole as CommunicationRole }
          : null;
      default:
        return null;
    }
  }

  /** Usuarios que recebem (ja sem inativos). */
  private async audienceFor(organizationId: number, reach: Reach, now: Date): Promise<Set<number>> {
    const base = { unitId: null, classId: null, stateUf: null, audienceRole: null };
    let users: Set<number>;
    switch (reach.scopeType) {
      case CommunicationScope.GROUP:
        users = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, base);
        break;
      case CommunicationScope.UNIT:
        users = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, { ...base, unitId: reach.unitId });
        break;
      case CommunicationScope.CLASS:
        users = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, { ...base, classId: reach.classId });
        break;
      case CommunicationScope.ROLE:
        if (reach.role === 'EQUIPE') {
          const staff = await this.prisma.organizationUser.findMany({
            where: { organizationId, status: 'ACTIVE', role: { in: STAFF_ROLES } },
            select: { userId: true },
          });
          users = new Set(staff.map((s) => s.userId));
        } else {
          users = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, {
            ...base,
            audienceRole: reach.role === 'ALUNO' ? OrgRole.ALUNO : OrgRole.RESPONSAVEL,
          });
        }
        break;
      case CommunicationScope.BIRTHDAY_MONTH:
        users = await this.birthdayMonthUserIds(organizationId, now);
        break;
    }
    return this.quickSend.activeOnly(organizationId, users);
  }

  /**
   * Aniversariantes do mes corrente (America/Sao_Paulo): ADULTOS que NAO deram opt-out (`Person.birthdayVisible`) +
   * a equipe (MESTRE/PROFESSOR/INSTRUTOR ativos, adultos, mesmo com opt-out: o opt-out so vale para os colegas).
   * Menor de 18 NUNCA entra (contrato secao 0.6). Fonte: `Person.birthDate`.
   */
  private async birthdayMonthUserIds(organizationId: number, now: Date): Promise<Set<number>> {
    const month = Number(todayCivil(now).slice(5, 7));
    const staffRows = await this.prisma.organizationUser.findMany({
      where: { organizationId, status: 'ACTIVE', role: { in: STAFF_ROLES } },
      select: { userId: true },
    });
    const staffIds = new Set(staffRows.map((s) => s.userId));
    const personFilter = { birthDate: { not: null }, anonymizedAt: null, mergedIntoId: null } satisfies Prisma.PersonWhereInput;
    const [students, staffPersons] = await Promise.all([
      this.prisma.student.findMany({
        where: { organizationId, status: 'ACTIVE', person: personFilter },
        select: { userId: true, person: { select: { userId: true, birthDate: true, birthdayVisible: true } } },
      }),
      this.prisma.person.findMany({
        where: { ...personFilter, userId: { in: [...staffIds] } },
        select: { userId: true, birthDate: true },
      }),
    ]);
    const eligible = (birthDate: Date | null): boolean =>
      birthDate !== null && birthDate.getUTCMonth() + 1 === month && !isMinor(birthDate, now);
    const users = new Set<number>();
    for (const s of students) {
      const person = s.person;
      if (!person || !eligible(person.birthDate)) continue;
      const userId = s.userId ?? person.userId;
      if (userId === null) continue;
      if (person.birthdayVisible || staffIds.has(userId)) users.add(userId);
    }
    for (const p of staffPersons) {
      if (p.userId !== null && eligible(p.birthDate)) users.add(p.userId);
    }
    return users;
  }

  // ---------------------------------------------------------------------------------------------
  // PREVIA / CRIAR
  // ---------------------------------------------------------------------------------------------

  async preview(organizationId: number, user: AuthenticatedUser, scope: ScopeInput): Promise<{ count: number; sample: { name: string }[] }> {
    const reach = await this.resolveReach(organizationId, user, scope);
    const audience = await this.audienceFor(organizationId, reach, new Date());
    const sample =
      audience.size === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: [...audience] } },
            select: { name: true },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            take: 5,
          });
    return { count: audience.size, sample: sample.map((u) => ({ name: u.name })) };
  }

  async create(
    organizationId: number,
    user: AuthenticatedUser,
    dto: CreateCommunicationDto,
  ): Promise<{ id: number; status: 'SENT' | 'SCHEDULED'; recipients: number }> {
    const now = new Date();
    // Imagem: so do proprio GingApp (/api/uploads/) ou https (nunca http: mixed content) — mesmo validador dos formularios.
    if (dto.imageUrl && !safeBannerUrl(dto.imageUrl)) {
      throw new BadRequestException('imageUrl deve ser uma imagem enviada pelo GingApp (/api/uploads/...) ou um endereço https://.');
    }
    const reach = await this.resolveReach(organizationId, user, dto.scope);

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (scheduledAt) {
      if (scheduledAt.getTime() <= now.getTime()) throw new BadRequestException('scheduledAt deve ser uma data futura.');
      if (scheduledAt.getTime() > now.getTime() + COMMUNICATION_MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
        throw new BadRequestException(`scheduledAt deve ser de no máximo ${COMMUNICATION_MAX_SCHEDULE_DAYS} dias a partir de agora.`);
      }
    }
    const pinToFeed = dto.pinToFeed === true;
    const pinnedUntil = pinToFeed && dto.pinnedUntil ? new Date(dto.pinnedUntil) : null;
    if (pinnedUntil) {
      if (pinnedUntil.getTime() <= now.getTime()) throw new BadRequestException('pinnedUntil deve ser uma data futura.');
      if (scheduledAt && pinnedUntil.getTime() <= scheduledAt.getTime()) {
        throw new BadRequestException('pinnedUntil deve ser depois do agendamento (scheduledAt).');
      }
    }

    const audience = await this.audienceFor(organizationId, reach, now);
    const count = audience.size;
    if (count === 0) {
      throw new BadRequestException(apiError(400, 'Bad Request', NO_RECIPIENTS_CODE, 'Nenhum destinatário encontrado para este alcance.'));
    }
    if (count > COMMUNICATION_CONFIRM_THRESHOLD && dto.confirmCount !== count) {
      throw new ConflictException(
        apiError(409, 'Conflict', RECIPIENTS_CHANGED_CODE, `O alcance tem ${count} destinatários; confirme a contagem para enviar.`, { count }),
      );
    }

    const { row, items } = await this.prisma.$transaction(async (tx) => {
      // Cota diaria por grupo/autor: contagem + criacao ATOMICAS (advisory lock por grupo; sem tabela de cota).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUOTA_LOCK_NS}::int, ${organizationId}::int)`;
      await this.assertQuota(tx, organizationId, user.id, now);
      const created = await tx.announcement.create({
        data: {
          organizationId,
          createdByUserId: user.id,
          title: dto.title,
          body: dto.body,
          imageUrl: dto.imageUrl ?? null,
          scopeType: reach.scopeType,
          unitId: reach.unitId,
          classId: reach.classId,
          scopeRole: reach.role,
          status: scheduledAt ? CommunicationStatus.SCHEDULED : CommunicationStatus.SENT,
          scheduledAt,
          publishedAt: scheduledAt ? null : now,
          requiresAck: dto.requiresAck ?? AckRequirement.NONE,
          pinToFeed,
          pinnedUntil,
          recipientsCount: count,
        },
      });
      const delivered = scheduledAt ? [] : await this.deliver(tx, created, audience);
      return { row: created, items: delivered };
    }, TX_OPTIONS);

    this.notifications.pushAfterCommit(items);
    await this.audit.record({
      organizationId,
      action: AuditAction.COMMUNICATION_CREATE,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: row.id,
      meta: {
        scope: reach.scopeType,
        unitId: reach.unitId,
        classId: reach.classId,
        role: reach.role,
        requiresAck: row.requiresAck,
        scheduled: !!scheduledAt,
        pinToFeed,
        recipients: count,
      },
    });
    if (!scheduledAt) {
      await this.audit.record({
        organizationId,
        action: AuditAction.COMMUNICATION_SEND,
        entity: AuditEntity.ANNOUNCEMENT,
        entityId: row.id,
        meta: { scope: reach.scopeType, recipients: items.length, scheduled: false },
      });
    }
    return { id: row.id, status: scheduledAt ? 'SCHEDULED' : 'SENT', recipients: scheduledAt ? count : items.length };
  }

  private async assertQuota(tx: Prisma.TransactionClient, organizationId: number, userId: number, now: Date): Promise<void> {
    const base: Prisma.AnnouncementWhereInput = {
      organizationId,
      scopeType: { not: null },
      status: { not: CommunicationStatus.CANCELLED },
      createdAt: { gte: startOfCivilDaySaoPaulo(now) },
    };
    const [orgCount, authorCount] = await Promise.all([
      tx.announcement.count({ where: base }),
      tx.announcement.count({ where: { ...base, createdByUserId: userId } }),
    ]);
    const orgLimit = limitFromEnv('COMM_DAILY_LIMIT_ORG', 30);
    const authorLimit = limitFromEnv('COMM_DAILY_LIMIT_AUTHOR', 15);
    if (orgCount >= orgLimit) {
      throw tooMany(COMM_QUOTA_EXCEEDED_CODE, `O grupo atingiu o limite de ${orgLimit} comunicados por dia. Tente amanhã.`, { limit: orgLimit, scope: 'ORG' });
    }
    if (authorCount >= authorLimit) {
      throw tooMany(COMM_QUOTA_EXCEEDED_CODE, `Você atingiu o limite de ${authorLimit} comunicados por dia. Tente amanhã.`, { limit: authorLimit, scope: 'AUTHOR' });
    }
  }

  /** Grava UMA notificacao por destinatario (SSOT NotificationsService.createMany, na transacao do chamador). O push sai depois do commit. */
  private async deliver(
    tx: Prisma.TransactionClient,
    row: Announcement,
    audience: Iterable<number>,
    options: { reminder?: boolean } = {},
  ): Promise<Prisma.NotificationCreateManyInput[]> {
    const userIds = [...new Set(audience)].sort((a, b) => a - b);
    const items: Prisma.NotificationCreateManyInput[] = userIds.map((userId) => ({
      organizationId: row.organizationId,
      userId,
      title: options.reminder ? `Lembrete: ${row.title}` : row.title,
      body: row.body,
      type: COMMUNICATION_NOTIFICATION_TYPE,
      data: { communicationId: row.id, requiresAck: row.requiresAck, ...(options.reminder ? { reminder: true } : {}) },
      announcementId: row.id,
    }));
    await this.notifications.createMany(items, tx);
    return items;
  }

  // ---------------------------------------------------------------------------------------------
  // HISTORICO / ESTATISTICAS
  // ---------------------------------------------------------------------------------------------

  private visibleWhere(organizationId: number, user: AuthenticatedUser): Prisma.AnnouncementWhereInput {
    const base: Prisma.AnnouncementWhereInput = { organizationId, scopeType: { not: null } };
    return this.isMestre(user) ? base : { ...base, createdByUserId: user.id };
  }

  private async statsFor(ids: number[]): Promise<Map<number, RowStats>> {
    const out = new Map<number, RowStats>();
    for (const id of ids) out.set(id, { readCount: 0, acks: { READ: 0, GOING: 0, NOT_GOING: 0 } });
    if (ids.length === 0) return out;
    const [reads, acks] = await Promise.all([
      this.prisma.$queryRaw<Array<{ announcementId: number; n: number }>>(Prisma.sql`
        SELECT t."announcementId", COUNT(*)::int AS n FROM (
          SELECT "announcementId", "userId" FROM "Notification"
            WHERE "announcementId" IN (${Prisma.join(ids)}) AND "readAt" IS NOT NULL
          UNION
          SELECT "announcementId", "userId" FROM "AnnouncementAck"
            WHERE "announcementId" IN (${Prisma.join(ids)})
        ) t GROUP BY t."announcementId"`),
      this.prisma.announcementAck.groupBy({
        by: ['announcementId', 'response'],
        where: { announcementId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    for (const r of reads) {
      const s = out.get(r.announcementId);
      if (s) s.readCount = r.n;
    }
    for (const a of acks) {
      const s = out.get(a.announcementId);
      if (s) s.acks[a.response] = a._count._all;
    }
    return out;
  }

  private toItem(row: CommunicationRow, stats: RowStats) {
    const ackCount = stats.acks.READ + stats.acks.GOING + stats.acks.NOT_GOING;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      scopeType: row.scopeType,
      scheduledAt: row.scheduledAt,
      sentAt: row.status === CommunicationStatus.SENT ? row.publishedAt : null,
      recipientsCount: row.recipientsCount,
      readCount: stats.readCount,
      ackCount,
      requiresAck: row.requiresAck,
      pinToFeed: row.pinToFeed,
      pinnedUntil: row.pinnedUntil,
      lastResendAt: row.lastResendAt,
      createdAt: row.createdAt,
      createdByName: row.createdByUser?.name ?? null,
    };
  }

  async findAll(organizationId: number, user: AuthenticatedUser, query: ListCommunicationsQueryDto): Promise<Page<unknown>> {
    const q = query.q?.trim();
    const where: Prisma.AnnouncementWhereInput = {
      AND: [
        this.visibleWhere(organizationId, user),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.scope ? [{ scopeType: query.scope }] : []),
        ...(q ? [{ OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { body: { contains: q, mode: 'insensitive' as const } }] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        include: { createdByUser: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.announcement.count({ where }),
    ]);
    const stats = await this.statsFor(rows.map((r) => r.id));
    return { items: rows.map((r) => this.toItem(r, stats.get(r.id)!)), total };
  }

  private async findVisible(organizationId: number, user: AuthenticatedUser, id: number): Promise<CommunicationRow> {
    const row = await this.prisma.announcement.findFirst({
      where: { AND: [this.visibleWhere(organizationId, user), { id }] },
      include: { createdByUser: { select: { name: true } }, unit: { select: { name: true } }, class: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Comunicado não encontrado.');
    return row;
  }

  async findOne(organizationId: number, user: AuthenticatedUser, id: number) {
    const row = await this.findVisible(organizationId, user, id);
    const stats = (await this.statsFor([id])).get(id)!;
    const item = this.toItem(row, stats);
    const pending =
      row.status !== CommunicationStatus.SENT
        ? 0
        : Math.max(0, row.recipientsCount - (row.requiresAck === AckRequirement.NONE ? stats.readCount : item.ackCount));
    return {
      ...item,
      body: row.body,
      imageUrl: row.imageUrl,
      scope: {
        type: row.scopeType,
        unitId: row.unitId,
        unitName: row.unit?.name ?? null,
        classId: row.classId,
        className: row.class?.name ?? null,
        role: row.scopeRole,
      },
      acks: stats.acks,
      pending,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // REENVIAR / CANCELAR
  // ---------------------------------------------------------------------------------------------

  async resendUnread(organizationId: number, user: AuthenticatedUser, id: number, now: Date = new Date()): Promise<{ sent: number }> {
    const row = await this.findVisible(organizationId, user, id);
    if (row.status !== CommunicationStatus.SENT) {
      throw new ConflictException(apiError(409, 'Conflict', NOT_SENT_CODE, 'Só é possível reenviar um comunicado já enviado.'));
    }
    const tooSoon = () =>
      tooMany(RESEND_TOO_SOON_CODE, 'O reenvio aos não lidos só pode ser feito uma vez a cada 24 horas.', {
        retryAfter: row.lastResendAt ? new Date(row.lastResendAt.getTime() + COMMUNICATION_RESEND_INTERVAL_MS).toISOString() : null,
      });
    const threshold = new Date(now.getTime() - COMMUNICATION_RESEND_INTERVAL_MS);
    if (row.lastResendAt && row.lastResendAt.getTime() > threshold.getTime()) throw tooSoon();

    // Quem recebeu e ainda nao leu (nem confirmou); inativos ficam de fora.
    const unread = await this.prisma.$queryRaw<Array<{ userId: number }>>(Prisma.sql`
      SELECT DISTINCT n."userId" FROM "Notification" n
      WHERE n."announcementId" = ${id}
        AND NOT EXISTS (SELECT 1 FROM "Notification" r WHERE r."announcementId" = n."announcementId" AND r."userId" = n."userId" AND r."readAt" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "AnnouncementAck" a WHERE a."announcementId" = n."announcementId" AND a."userId" = n."userId")`);
    const targets = await this.quickSend.activeOnly(organizationId, new Set(unread.map((u) => u.userId)));
    if (targets.size === 0) return { sent: 0 };

    // Reivindica o direito de reenviar de forma atomica (duas chamadas simultaneas: so uma passa).
    const claimed = await this.prisma.announcement.updateMany({
      where: {
        id,
        organizationId,
        status: CommunicationStatus.SENT,
        OR: [{ lastResendAt: null }, { lastResendAt: { lte: threshold } }],
      },
      data: { lastResendAt: now },
    });
    if (claimed.count === 0) throw tooSoon();

    const items = await this.prisma.$transaction((tx) => this.deliver(tx, row, targets, { reminder: true }), TX_OPTIONS);
    this.notifications.pushAfterCommit(items);
    await this.audit.record({
      organizationId,
      action: AuditAction.COMMUNICATION_RESEND,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: id,
      meta: { sent: items.length },
    });
    return { sent: items.length };
  }

  async cancel(organizationId: number, user: AuthenticatedUser, id: number): Promise<{ id: number; status: 'CANCELLED' }> {
    const row = await this.findVisible(organizationId, user, id);
    const cancelled = await this.prisma.announcement.updateMany({
      where: { id, organizationId, status: CommunicationStatus.SCHEDULED },
      data: { status: CommunicationStatus.CANCELLED },
    });
    if (cancelled.count === 0) {
      if (row.status === CommunicationStatus.CANCELLED) return { id, status: 'CANCELLED' }; // idempotente
      // Enviado (ou o agendador acabou de enviar): nao se cancela.
      throw new ConflictException(apiError(409, 'Conflict', ALREADY_SENT_CODE, 'Este comunicado já foi enviado e não pode ser cancelado.'));
    }
    await this.audit.record({
      organizationId,
      action: AuditAction.COMMUNICATION_CANCEL,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: id,
      meta: { scope: row.scopeType },
    });
    return { id, status: 'CANCELLED' };
  }

  // ---------------------------------------------------------------------------------------------
  // APP (MEMBRO): FIXADOS E CONFIRMACAO
  // ---------------------------------------------------------------------------------------------

  /** O usuario esta no alcance do comunicado? GROUP = qualquer membro do grupo; senao, quem recebeu a notificacao. */
  private async inReach(userId: number, row: Pick<Announcement, 'id' | 'scopeType'>): Promise<boolean> {
    if (row.scopeType === CommunicationScope.GROUP) return true;
    const found = await this.prisma.notification.findFirst({ where: { userId, announcementId: row.id }, select: { id: true } });
    return found !== null;
  }

  async pinned(organizationId: number, userId: number, now: Date = new Date()) {
    const rows = await this.prisma.announcement.findMany({
      where: {
        organizationId,
        scopeType: { not: null },
        pinToFeed: true,
        status: CommunicationStatus.SENT,
        isActive: true,
        OR: [{ pinnedUntil: null }, { pinnedUntil: { gt: now } }],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    if (rows.length === 0) return { items: [] };
    const ids = rows.map((r) => r.id);
    const [received, acks] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId, announcementId: { in: ids } }, select: { announcementId: true }, distinct: ['announcementId'] }),
      this.prisma.announcementAck.findMany({ where: { userId, announcementId: { in: ids } }, select: { announcementId: true, response: true } }),
    ]);
    const receivedIds = new Set(received.map((r) => r.announcementId));
    const myAck = new Map(acks.map((a) => [a.announcementId, a.response]));
    return {
      items: rows
        .filter((r) => r.scopeType === CommunicationScope.GROUP || receivedIds.has(r.id))
        .map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          imageUrl: r.imageUrl,
          requiresAck: r.requiresAck,
          myAck: myAck.get(r.id) ?? null,
          pinnedUntil: r.pinnedUntil,
          createdAt: r.createdAt,
        })),
    };
  }

  async ack(organizationId: number, userId: number, id: number, response: AckResponse): Promise<{ ok: true; response: AckResponse }> {
    const row = await this.prisma.announcement.findFirst({
      where: { id, organizationId, scopeType: { not: null }, status: CommunicationStatus.SENT, isActive: true },
    });
    if (!row) throw new NotFoundException('Comunicado não encontrado.');
    if (!(await this.inReach(userId, row))) {
      throw new ForbiddenException(apiError(403, 'Forbidden', NOT_RECIPIENT_CODE, 'Este comunicado não foi enviado para você.'));
    }
    // "Vou"/"Não vou" so quando o comunicado pede presenca; "Li" vale em qualquer um (apenas marca como lido).
    if (response !== AckResponse.READ && row.requiresAck !== AckRequirement.GOING) {
      throw new BadRequestException(apiError(400, 'Bad Request', ACK_NOT_ALLOWED_CODE, 'Este comunicado não pede confirmação de presença.'));
    }
    const existing = await this.prisma.announcementAck.findUnique({ where: { announcementId_userId: { announcementId: id, userId } } });
    let stored: AckResponse = response;
    if (response === AckResponse.READ && existing && existing.response !== AckResponse.READ) {
      stored = existing.response; // "Li" nunca sobrescreve uma resposta de presenca ja dada
    } else {
      await this.prisma.announcementAck.upsert({
        where: { announcementId_userId: { announcementId: id, userId } },
        create: { organizationId, announcementId: id, userId, response },
        update: { response },
      });
    }
    // Confirmar implica ter lido: marca as notificacoes desse comunicado como lidas.
    await this.prisma.notification.updateMany({ where: { userId, announcementId: id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, response: stored };
  }

  // ---------------------------------------------------------------------------------------------
  // AGENDADOR
  // ---------------------------------------------------------------------------------------------

  /**
   * Envia os agendados vencidos (chamado pelo agendador a cada minuto; `now` injetavel). Idempotente: cada comunicado
   * e reivindicado por uma transicao atomica SCHEDULED -> SENT dentro da mesma transacao que grava as notificacoes
   * (falha = rollback, volta a SCHEDULED e tenta de novo no proximo minuto; duas instancias nunca enviam duas vezes).
   * Alcance que ficou invalido (turma apagada) cancela o comunicado em vez de virar um envio ao grupo inteiro.
   */
  async sendDueScheduled(
    now: Date = new Date(),
    options: { organizationId?: number } = {},
  ): Promise<{ sent: number; cancelled: number; failed: number }> {
    const due = await this.prisma.announcement.findMany({
      where: {
        status: CommunicationStatus.SCHEDULED,
        scheduledAt: { lte: now },
        scopeType: { not: null },
        ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}),
      },
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: SCHEDULER_BATCH,
    });
    const result = { sent: 0, cancelled: 0, failed: 0 };
    for (const { id } of due) {
      try {
        const outcome = await this.sendScheduledOne(id, now);
        if (outcome === 'sent') result.sent += 1;
        else if (outcome === 'cancelled') result.cancelled += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(`Falha ao enviar o comunicado agendado ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }

  private async sendScheduledOne(id: number, now: Date): Promise<'sent' | 'cancelled' | 'skipped'> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.announcement.updateMany({
        where: { id, status: CommunicationStatus.SCHEDULED, scheduledAt: { lte: now } },
        data: { status: CommunicationStatus.SENT, publishedAt: now },
      });
      if (claimed.count === 0) return null; // outro processo (ou o autor, cancelando) chegou antes
      const row = await tx.announcement.findUniqueOrThrow({ where: { id } });
      const reach = this.reachOf(row);
      if (!reach) {
        await tx.announcement.update({ where: { id }, data: { status: CommunicationStatus.CANCELLED, publishedAt: null } });
        return { kind: 'cancelled' as const, row, items: [] as Prisma.NotificationCreateManyInput[] };
      }
      const audience = await this.audienceFor(row.organizationId, reach, now);
      const items = await this.deliver(tx, row, audience);
      await tx.announcement.update({ where: { id }, data: { recipientsCount: items.length } });
      return { kind: 'sent' as const, row, items };
    }, TX_OPTIONS);

    if (!outcome) return 'skipped';
    if (outcome.kind === 'cancelled') {
      this.logger.warn(`Comunicado agendado ${id} cancelado: o alcance (turma/unidade) não existe mais.`);
      await this.audit.record({
        organizationId: outcome.row.organizationId,
        userId: null,
        ip: null,
        action: AuditAction.COMMUNICATION_CANCEL,
        entity: AuditEntity.ANNOUNCEMENT,
        entityId: id,
        meta: { scope: outcome.row.scopeType, reason: 'REACH_INVALID' },
      });
      return 'cancelled';
    }
    this.notifications.pushAfterCommit(outcome.items);
    await this.audit.record({
      organizationId: outcome.row.organizationId,
      userId: null,
      ip: null,
      action: AuditAction.COMMUNICATION_SEND,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: id,
      meta: { scope: outcome.row.scopeType, recipients: outcome.items.length, scheduled: true },
    });
    return 'sent';
  }
}
