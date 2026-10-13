import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  assertUnitOwned,
  assertUnitUpdate,
  groupWideOrUnitFilter,
  resolveWriteUnit,
  UnitScopeService,
} from '../../../shared/access/unit-scope';
import { StudentsService } from '../students/students.service';
import { NotificationsService } from '../notifications/notifications.service';
import { announcementAudienceUserIds } from './announcement-audience';
import { unitScopeFilter } from '../../../shared/access/unit-scope';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';

/**
 * Comunicados internos do grupo (projeto.txt §46-47). Escopo hoje é binário pelo schema
 * existente: `unitId` nulo = grupo inteiro, `unitId` preenchido = só aquela unidade — não
 * cobre os escopos mais finos do texto de produto (minha turma/meu estado/público), que
 * exigiriam campos novos (pendência registrada no plano).
 *
 * Ao publicar (create), distribui uma Notification para cada usuário do público-alvo — é
 * isso que faz o comunicado aparecer no sino de notificações do PWA. Não refaz a
 * distribuição em edições (update), só na criação, para não notificar de novo por causa de
 * uma correção de texto.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Visibilidade (LGPD, menor privilégio) — duas visões na MESMA rota:
   * - Staff (quem PUBLICA: `announcements.create` na matriz RolePermission, ou PLATFORM —
   *   MESTRE/PROFESSOR): vê todos os comunicados da organização, de todas as unidades, com
   *   todos os campos (inclusive createdByUserId).
   * - Demais (ALUNO/RESPONSAVEL, e qualquer papel sem `create`): só os comunicados do PRÓPRIO
   *   vínculo, e sem createdByUserId (id interno do autor). A regra é a MESMA do público-alvo
   *   que recebe a Notification em `notifyAudience`: comunicado geral da organização
   *   (`unitId` nulo) + comunicados das unidades do usuário, onde "unidades do usuário" =
   *   unidade do seu Student (próprio) e dos alunos de quem ele é responsável
   *   (StudentsService.findMine, SSOT de "próprio ou dependente") + unidades de UserUnitAccess.
   *   Quem não tem vínculo com nenhuma unidade só vê os gerais. Comunicado de OUTRA unidade do
   *   grupo (ou de outra organização) é invisível: some da lista (e do X-Total-Count) e, por id,
   *   dá o MESMO 404 de um id inexistente.
   *   Estes papéis também NÃO veem comunicado inativo (isActive=false, o soft-delete de `remove`)
   *   nem ainda não publicado (publishedAt no futuro; publishedAt nulo = já publicado) — mesma
   *   semântica de PlatformAnnouncementsService.findActiveForOrganization. Vale para lista,
   *   total e id (404 igual ao inexistente). Staff continua vendo tudo (inativos e agendados).
   * Os filtros da query (unitId, isActive, q) se COMBINAM com o escopo — nunca o ampliam.
   */
  private async memberScope(
    organizationId: number,
    requester: AuthenticatedUser,
  ): Promise<{ where: Prisma.AnnouncementWhereInput | null; member: boolean }> {
    if (await this.permissions.can(requester, 'announcements', 'create')) {
      // Staff vê tudo (com autor), EXCETO o PROFESSOR com unidades atribuídas (E08): só os do grupo inteiro e das
      // suas unidades (continua vendo inativos/agendados e o autor — é só o recorte de unidade).
      const unitFilter = groupWideOrUnitFilter(await this.unitScope.resolve(requester, organizationId));
      return { where: unitFilter.OR ? { AND: [unitFilter] } : null, member: false };
    }
    const [students, access] = await Promise.all([
      this.studentsService.findMine(organizationId, requester.id),
      this.prisma.userUnitAccess.findMany({
        where: { organizationId, userId: requester.id },
        select: { unitId: true },
      }),
    ]);
    const unitIds = new Set<number>();
    for (const student of students) {
      if (student.unitId !== null) unitIds.add(student.unitId);
    }
    for (const row of access) unitIds.add(row.unitId);
    // Recortes adicionais (turma / UF / papel): o membro so ve o comunicado dirigido a uma turma em que ele (ou um
    // dependente) esta matriculado, a uma UF onde tem unidade e ao seu papel; sem recorte = visivel como antes.
    const [enrollments, units] = await Promise.all([
      this.prisma.classStudent.findMany({
        where: { organizationId, status: 'ACTIVE', studentId: { in: students.map((s) => s.id) } },
        select: { classId: true },
      }),
      this.prisma.unit.findMany({ where: { organizationId, id: { in: [...unitIds] } }, select: { state: true } }),
    ]);
    const classIds = [...new Set(enrollments.map((e) => e.classId))];
    const ufs = [...new Set(units.flatMap((u) => (u.state ? [u.state] : [])))];
    return {
      where: {
        AND: [
          { isActive: true },
          { OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }] },
          { OR: [{ unitId: null }, { unitId: { in: [...unitIds] } }] },
          { OR: [{ classId: null }, { classId: { in: classIds } }] },
          { OR: [{ stateUf: null }, { stateUf: { in: ufs } }] },
          { OR: [{ audienceRole: null }, ...(requester.role ? [{ audienceRole: requester.role }] : [])] },
        ],
      },
      member: true,
    };
  }

  async findAll(
    organizationId: number,
    requester: AuthenticatedUser,
    query: ListAnnouncementsQueryDto = {},
  ): Promise<Page<unknown>> {
    const q = query.q?.trim();
    const { where: scope, member } = await this.memberScope(organizationId, requester);
    const and: Prisma.AnnouncementWhereInput[] = [];
    if (scope) and.push(scope);
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { body: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.AnnouncementWhereInput = {
      organizationId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.unitId !== undefined ? { unitId: query.unitId } : {}),
      ...(query.classId !== undefined ? { classId: query.classId } : {}),
      AND: and,
    };
    const omit = member ? { createdByUserId: true as const } : undefined;

    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ where, orderBy: { id: 'desc' }, omit, ...pageArgs(query) }),
      this.prisma.announcement.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number, requester: AuthenticatedUser) {
    const { where: scope, member } = await this.memberScope(organizationId, requester);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, organizationId, ...(scope ? { AND: [scope] } : {}) },
      omit: member ? { createdByUserId: true } : undefined,
    });
    if (!announcement) {
      throw new NotFoundException('Comunicado não encontrado.');
    }
    return announcement;
  }

  /** Leitura sem o escopo de visibilidade de MEMBRO — SÓ para update/remove, que já exigem
   * `announcements.edit/delete` (staff) na matriz. O PROFESSOR com unidades atribuídas (E08) continua sem enxergar
   * (404) comunicados de unidades fora do escopo, e só altera os das suas unidades (o do grupo inteiro: 403). */
  private async findOneOrFail(organizationId: number, id: number, requester?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(requester, organizationId);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, organizationId, AND: [groupWideOrUnitFilter(scope)] },
    });
    if (!announcement) {
      throw new NotFoundException('Comunicado não encontrado.');
    }
    return announcement;
  }

  /** `options.notify = false`: o chamador (envio rapido, POST /notifications/send) notifica por conta propria, uma vez por
   * destinatario, e NAO quer o aviso duplicado do comunicado. */
  async create(
    organizationId: number,
    createdByUserId: number,
    dto: CreateAnnouncementDto,
    requester?: AuthenticatedUser,
    options: { notify?: boolean } = {},
  ) {
    // Professor restrito: publica para uma das suas unidades (a única, por padrão), nunca para o grupo inteiro.
    const unitId = resolveWriteUnit(await this.unitScope.resolve(requester, organizationId), dto.unitId);
    if (unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, unitId);
    }
    if (dto.classId != null) {
      await this.assertClassInScope(organizationId, dto.classId, await this.unitScope.resolve(requester, organizationId));
    }

    const announcement = await this.prisma.announcement.create({
      data: {
        organizationId,
        unitId,
        title: dto.title,
        body: dto.body,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
        classId: dto.classId,
        stateUf: dto.stateUf,
        audienceRole: dto.audienceRole,
        createdByUserId,
      },
    });

    // Público-alvo e gravação em lote: SSOT em NotificationsService (unitId nulo = todo membro ativo), afinado pelo
    // alcance extra do comunicado (turma / UF / papel — announcement-audience.ts).
    if (options.notify !== false) {
      await this.notifications.notifyUsers(
        organizationId,
        await announcementAudienceUserIds(this.prisma, this.notifications, organizationId, {
          unitId: unitId ?? null,
          classId: announcement.classId,
          stateUf: announcement.stateUf,
          audienceRole: announcement.audienceRole,
        }),
        { title: announcement.title, body: announcement.body, type: 'ANNOUNCEMENT' },
      );
    }

    await this.audit.record({
      organizationId,
      action: AuditAction.ANNOUNCEMENT_CREATE,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: announcement.id,
      meta: { title: announcement.title, unitId },
    });
    return announcement;
  }

  async update(organizationId: number, id: number, dto: UpdateAnnouncementDto, requester?: AuthenticatedUser) {
    const current = await this.findOneOrFail(organizationId, id, requester);
    const scope = await this.unitScope.resolve(requester, organizationId);
    assertUnitOwned(scope, current.unitId);
    assertUnitUpdate(scope, dto.unitId);

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    if (dto.classId != null) {
      await this.assertClassInScope(organizationId, dto.classId, scope);
    }

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        unitId: dto.unitId,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
        isActive: dto.isActive,
        classId: dto.classId,
        stateUf: dto.stateUf,
        audienceRole: dto.audienceRole,
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.ANNOUNCEMENT_UPDATE,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: id,
      meta: {
        fields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        isActive: updated.isActive,
      },
    });
    return updated;
  }

  /** Nunca apaga (comunicado é registro de comunicação, com valor de auditoria) — marca
   * isActive = false, mesmo espírito de soft-delete dos outros módulos. */
  async remove(organizationId: number, id: number, requester?: AuthenticatedUser) {
    const current = await this.findOneOrFail(organizationId, id, requester);
    assertUnitOwned(await this.unitScope.resolve(requester, organizationId), current.unitId);
    const updated = await this.prisma.announcement.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({
      organizationId,
      action: AuditAction.ANNOUNCEMENT_UPDATE,
      entity: AuditEntity.ANNOUNCEMENT,
      entityId: id,
      meta: { inactivated: true },
    });
    return updated;
  }

  /** A turma do alcance tem de ser do grupo e (professor restrito) de uma das suas unidades; senao 400 (mesmo erro de turma inexistente). */
  private async assertClassInScope(organizationId: number, classId: number, scope: Awaited<ReturnType<UnitScopeService['resolve']>>): Promise<void> {
    const found = await this.prisma.class.findFirst({
      where: { id: classId, organizationId, AND: [unitScopeFilter(scope)] },
      select: { id: true },
    });
    if (!found) throw new BadRequestException('Turma inválida para esta organização.');
  }

  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }
}
