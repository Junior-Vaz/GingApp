import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.announcement.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
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
    await this.findOne(organizationId, id);

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
    await this.findOne(organizationId, id);
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
