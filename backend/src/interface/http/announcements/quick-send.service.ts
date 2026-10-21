import { BadRequestException, Injectable } from '@nestjs/common';
import { OrgRole, UserType } from '@prisma/client';
import {
  assertUnitOwned,
  assertUnitTarget,
  isRestricted,
  resolveWriteUnit,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { BROADCAST_RECIPIENT_LIMIT, NotificationsService } from '../notifications/notifications.service';
import { AnnouncementReach, announcementAudienceUserIds } from './announcement-audience';
import { AnnouncementsService } from './announcements.service';
import { QuickSendDto } from './dto/quick-send.dto';

export const NO_RECIPIENTS_CODE = 'NO_RECIPIENTS';
export const QUICK_SEND_TYPE = 'ANNOUNCEMENT_QUICK';

export interface QuickSendResult {
  /** Notificações gravadas (uma por destinatário; cada uma vira push conforme as preferências do usuário). */
  sent: number;
  /** Id do comunicado criado no mural (`alsoPublish: true`) ou null. */
  announcementId: number | null;
}

const ROLE_LABELS: Record<OrgRole, string> = {
  ALUNO: 'Alunos',
  RESPONSAVEL: 'Responsáveis',
  PROFESSOR: 'Professores',
  INSTRUTOR: 'Instrutores',
  MONITOR: 'Monitores',
  MESTRE: 'Mestres',
};

/**
 * Envio rápido de avisos (botão flutuante do painel): POST /notifications/send e GET /notifications/audiences.
 * NÃO reimplementa audiência: o público sai de announcementAudienceUserIds (announcement-audience.ts, base em
 * NotificationsService.audienceUserIds) e o comunicado opcional (`alsoPublish`) é criado pelo AnnouncementsService com
 * `notify: false` — a notificação é gravada UMA vez por destinatário, aqui, em um único createMany.
 * Escopo de unidade (E08): professor restrito não envia ao grupo inteiro (403) nem a unidade/turma/aluno fora do escopo (403).
 * Nunca envia a quem foi desativado (usuário ou vínculo com o grupo INACTIVE).
 */
@Injectable()
export class QuickSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly announcements: AnnouncementsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  async send(organizationId: number, user: AuthenticatedUser, dto: QuickSendDto): Promise<QuickSendResult> {
    const { audience } = dto;
    if (dto.alsoPublish && audience.scope === 'STUDENTS') {
      throw new BadRequestException('alsoPublish não se aplica a alunos escolhidos (o mural não tem esse alcance).');
    }
    const scope = await this.unitScope.resolve(user, organizationId);
    const reach: AnnouncementReach = { unitId: null, classId: null, stateUf: null, audienceRole: null };
    let recipients: Set<number>;

    switch (audience.scope) {
      case 'GROUP': {
        assertUnitOwned(scope, null); // professor restrito nunca fala com o grupo inteiro
        recipients = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, reach);
        break;
      }
      case 'UNIT': {
        if (audience.unitId == null) throw new BadRequestException('Informe a unidade (audience.unitId).');
        assertUnitOwned(scope, audience.unitId);
        await this.assertUnitInOrganization(organizationId, audience.unitId);
        reach.unitId = audience.unitId;
        recipients = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, reach);
        break;
      }
      case 'CLASS': {
        if (audience.classId == null) throw new BadRequestException('Informe a turma (audience.classId).');
        const klass = await this.prisma.class.findFirst({
          where: { id: audience.classId, organizationId },
          select: { id: true, unitId: true },
        });
        if (!klass) throw new BadRequestException('Turma inválida para esta organização.');
        assertUnitTarget(scope, klass.unitId);
        reach.classId = klass.id;
        recipients = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, reach);
        break;
      }
      case 'ROLE': {
        if (audience.audienceRole == null) throw new BadRequestException('Informe o papel (audience.audienceRole).');
        // Restrito: assume a única unidade dele (ou 400 se tem várias); irrestrito: unidade opcional.
        const unitId = resolveWriteUnit(scope, audience.unitId);
        if (unitId != null) await this.assertUnitInOrganization(organizationId, unitId);
        reach.unitId = unitId ?? null;
        reach.audienceRole = audience.audienceRole;
        recipients = await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, reach);
        break;
      }
      case 'STUDENTS': {
        recipients = await this.studentsAudience(organizationId, scope, audience.studentIds ?? []);
        break;
      }
    }
    const active = await this.activeOnly(organizationId, recipients);
    if (active.size === 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: NO_RECIPIENTS_CODE,
        message: 'Nenhum destinatário encontrado para este alcance.',
      });
    }

    let announcementId: number | null = null;
    if (dto.alsoPublish) {
      const announcement = await this.announcements.create(
        organizationId,
        user.id,
        {
          title: dto.title,
          body: dto.body,
          unitId: reach.unitId ?? undefined,
          classId: reach.classId ?? undefined,
          audienceRole: reach.audienceRole ?? undefined,
        },
        user,
        { notify: false },
      );
      announcementId = announcement.id;
    }

    const sent = await this.notifications.notifyUsers(
      organizationId,
      active,
      { title: dto.title, body: dto.body, type: dto.alsoPublish ? 'ANNOUNCEMENT' : QUICK_SEND_TYPE },
      BROADCAST_RECIPIENT_LIMIT,
    );

    // Auditoria: alcance e contagem — NUNCA o texto do aviso.
    await this.audit.record({
      organizationId,
      action: AuditAction.NOTIFICATION_SEND,
      entity: AuditEntity.NOTIFICATION,
      entityId: announcementId,
      meta: {
        scope: audience.scope,
        unitId: reach.unitId,
        classId: reach.classId,
        audienceRole: reach.audienceRole,
        studentCount: audience.studentIds?.length ?? null,
        recipients: active.size,
        sent,
        alsoPublish: !!dto.alsoPublish,
        announcementId,
      },
    });
    return { sent, announcementId };
  }

  /** Opções de alcance respeitando o escopo de unidade (professor restrito só vê as unidades/turmas dele). */
  async audiences(organizationId: number, user: AuthenticatedUser, options: { ownClasses?: boolean } = {}) {
    const scope = await this.unitScope.resolve(user, organizationId);
    // Comunicar: PROFESSOR/INSTRUTOR so envia as turmas em que leciona (turma ou aula); MESTRE/plataforma, todas.
    const onlyOwn = options.ownClasses === true && user.role !== OrgRole.MESTRE && !user.isSuperAdmin && user.userType !== UserType.PLATFORM;
    const [units, classes] = await Promise.all([
      this.prisma.unit.findMany({
        where: { organizationId, status: 'ACTIVE', ...(isRestricted(scope) ? { id: { in: scope } } : {}) },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.class.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          AND: [unitScopeFilter(scope)],
          ...(onlyOwn ? { OR: [{ teacherUserId: user.id }, { lessons: { some: { teacherUserId: user.id } } }] } : {}),
        },
        select: { id: true, name: true, unitId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      /** false = professor restrito: não pode enviar ao grupo inteiro (scope GROUP => 403). */
      groupWide: !isRestricted(scope),
      units,
      classes,
      roles: (Object.keys(ROLE_LABELS) as OrgRole[]).map((value) => ({ value, label: ROLE_LABELS[value] })),
    };
  }

  /** Alunos escolhidos: do grupo (senão 400), ativos (inativos são ignorados) e dentro do escopo (senão 403) + responsáveis. */
  private async studentsAudience(
    organizationId: number,
    scope: Awaited<ReturnType<UnitScopeService['resolve']>>,
    studentIds: number[],
  ): Promise<Set<number>> {
    const ids = [...new Set(studentIds)];
    if (ids.length === 0) throw new BadRequestException('Informe os alunos (audience.studentIds).');
    const students = await this.prisma.student.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, unitId: true, status: true },
    });
    if (students.length !== ids.length) throw new BadRequestException('Aluno inválido para esta organização.');
    for (const student of students) assertUnitTarget(scope, student.unitId);
    const active = students.filter((s) => s.status === 'ACTIVE').map((s) => s.id);
    const byStudent = await this.notifications.userIdsByStudent(organizationId, active);
    return new Set([...byStudent.values()].flat());
  }

  /** Remove usuário inativo ou com vínculo INACTIVE neste grupo ("nunca enviar para quem desativou"). */
  async activeOnly(organizationId: number, userIds: Set<number>): Promise<Set<number>> {
    if (userIds.size === 0) return userIds;
    const rows = await this.prisma.user.findMany({
      where: {
        id: { in: [...userIds] },
        status: 'ACTIVE',
        memberships: { none: { organizationId, status: { not: 'ACTIVE' } } },
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  private async assertUnitInOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId }, select: { id: true } });
    if (!unit) throw new BadRequestException('Unidade inválida para esta organização.');
  }
}
