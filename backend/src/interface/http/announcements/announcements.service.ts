import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

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
   * Os filtros da query (unitId, isActive, q) se COMBINAM com o escopo — nunca o ampliam.
   */
  private async memberScope(
    organizationId: number,
    requester: AuthenticatedUser,
  ): Promise<Prisma.AnnouncementWhereInput | null> {
    if (await this.permissions.can(requester, 'announcements', 'create')) {
      return null;
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
    return { OR: [{ unitId: null }, { unitId: { in: [...unitIds] } }] };
  }

  async findAll(
    organizationId: number,
    requester: AuthenticatedUser,
    query: ListAnnouncementsQueryDto = {},
  ): Promise<Page<unknown>> {
    const q = query.q?.trim();
    const scope = await this.memberScope(organizationId, requester);
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
      AND: and,
    };
    const omit = scope ? { createdByUserId: true as const } : undefined;

    const [items, total] = await Promise.all([
      this.prisma.announcement.findMany({ where, orderBy: { id: 'desc' }, omit, ...pageArgs(query) }),
      this.prisma.announcement.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number, requester: AuthenticatedUser) {
    const scope = await this.memberScope(organizationId, requester);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, organizationId, ...(scope ? { AND: [scope] } : {}) },
      omit: scope ? { createdByUserId: true } : undefined,
    });
    if (!announcement) {
      throw new NotFoundException('Comunicado não encontrado.');
    }
    return announcement;
  }

  /** Leitura sem escopo de visibilidade — SÓ para update/remove, que já exigem
   * `announcements.edit/delete` (staff) na matriz. */
  private async findOneOrFail(organizationId: number, id: number) {
    const announcement = await this.prisma.announcement.findFirst({ where: { id, organizationId } });
    if (!announcement) {
      throw new NotFoundException('Comunicado não encontrado.');
    }
    return announcement;
  }

  async create(organizationId: number, createdByUserId: number, dto: CreateAnnouncementDto) {
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    const announcement = await this.prisma.announcement.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        title: dto.title,
        body: dto.body,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
        createdByUserId,
      },
    });

    await this.notifyAudience(organizationId, dto.unitId ?? null, announcement.title, announcement.body);

    return announcement;
  }

  async update(organizationId: number, id: number, dto: UpdateAnnouncementDto) {
    await this.findOneOrFail(organizationId, id);

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        unitId: dto.unitId,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  /** Nunca apaga (comunicado é registro de comunicação, com valor de auditoria) — marca
   * isActive = false, mesmo espírito de soft-delete dos outros módulos. */
  async remove(organizationId: number, id: number) {
    await this.findOneOrFail(organizationId, id);
    return this.prisma.announcement.update({ where: { id }, data: { isActive: false } });
  }

  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }

  /**
   * Monta o público-alvo e cria uma Notification por usuário.
   * - unitId nulo: todo membro ativo da organização (qualquer papel).
   * - unitId preenchido: MESTRE (sempre, vê tudo), professores com acesso àquela unidade,
   *   alunos daquela unidade e os responsáveis vinculados a eles.
   */
  private async notifyAudience(
    organizationId: number,
    unitId: number | null,
    title: string,
    body: string,
  ): Promise<void> {
    const userIds = new Set<number>();

    if (unitId === null) {
      const members = await this.prisma.organizationUser.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { userId: true },
      });
      members.forEach((m) => userIds.add(m.userId));
    } else {
      const [mestres, unitAccess, students, guardians] = await Promise.all([
        this.prisma.organizationUser.findMany({
          where: { organizationId, status: 'ACTIVE', role: OrgRole.MESTRE },
          select: { userId: true },
        }),
        this.prisma.userUnitAccess.findMany({
          where: { organizationId, unitId },
          select: { userId: true },
        }),
        this.prisma.student.findMany({
          where: { organizationId, unitId, userId: { not: null } },
          select: { userId: true },
        }),
        this.prisma.studentGuardian.findMany({
          where: { organizationId, userId: { not: null }, student: { unitId } },
          select: { userId: true },
        }),
      ]);
      mestres.forEach((m) => userIds.add(m.userId));
      unitAccess.forEach((u) => userIds.add(u.userId));
      students.forEach((s) => s.userId && userIds.add(s.userId));
      guardians.forEach((g) => g.userId && userIds.add(g.userId));
    }

    if (userIds.size === 0) return;

    await this.prisma.notification.createMany({
      data: Array.from(userIds).map((userId) => ({
        organizationId,
        userId,
        title,
        body,
        type: 'ANNOUNCEMENT',
      })),
    });
  }
}
