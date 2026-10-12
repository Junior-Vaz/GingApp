import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePlatformAnnouncementDto } from './dto/create-platform-announcement.dto';
import { UpdatePlatformAnnouncementDto } from './dto/update-platform-announcement.dto';

/**
 * Avisos da equipe GingApp para os grupos (Fase 2 — "SaaS Admin completo", diferente de
 * Announcement, que é o comunicado interno de um grupo para os próprios membros). Escopo:
 * `targetOrganizationId` nulo = todos os grupos da plataforma; preenchido = só aquele grupo.
 *
 * Ao publicar (create), distribui uma Notification para cada usuário ativo do público-alvo —
 * mesmo mecanismo de AnnouncementsService.notifyAudience, mas a fonte é a equipe PLATFORM, não
 * um MESTRE. Não redistribui em edições, só na criação (mesmo motivo: não renotificar por causa
 * de uma correção de texto).
 */
@Injectable()
export class PlatformAnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  findAll() {
    return this.prisma.platformAnnouncement.findMany({
      include: { targetOrganization: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: number) {
    const announcement = await this.prisma.platformAnnouncement.findUnique({
      where: { id },
      include: { targetOrganization: { select: { id: true, name: true } } },
    });
    if (!announcement) {
      throw new NotFoundException('Aviso não encontrado.');
    }
    return announcement;
  }

  /** Avisos visíveis para o grupo autenticado: globais + os dirigidos a ele, ativos, já
   * publicados e ainda não expirados. */
  findActiveForOrganization(organizationId: number) {
    const now = new Date();
    return this.prisma.platformAnnouncement.findMany({
      where: {
        isActive: true,
        OR: [{ targetOrganizationId: null }, { targetOrganizationId: organizationId }],
        AND: [
          { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async create(createdByUserId: number, dto: CreatePlatformAnnouncementDto) {
    if (dto.targetOrganizationId) {
      await this.assertOrganizationExists(dto.targetOrganizationId);
    }

    const announcement = await this.prisma.platformAnnouncement.create({
      data: {
        title: dto.title,
        body: dto.body,
        targetOrganizationId: dto.targetOrganizationId,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdByUserId,
      },
    });

    await this.notifyAudience(dto.targetOrganizationId ?? null, announcement.title, announcement.body);

    return announcement;
  }

  async update(id: number, dto: UpdatePlatformAnnouncementDto) {
    await this.findOne(id);
    return this.prisma.platformAnnouncement.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  /** Nunca apaga (é registro de comunicação da plataforma, com valor de auditoria) — marca
   * isActive = false, mesmo padrão de soft-delete de Announcement. */
  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.platformAnnouncement.update({ where: { id }, data: { isActive: false } });
  }

  private async assertOrganizationExists(organizationId: number): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new BadRequestException('Organização de destino inválida.');
    }
  }

  private async notifyAudience(
    targetOrganizationId: number | null,
    title: string,
    body: string,
  ): Promise<void> {
    const members = await this.prisma.organizationUser.findMany({
      where: {
        status: 'ACTIVE',
        ...(targetOrganizationId ? { organizationId: targetOrganizationId } : {}),
      },
      select: { userId: true, organizationId: true },
    });

    if (members.length === 0) return;

    // NotificationsService e' o SSOT de escrita em Notification (em lotes, e dispara o Web Push em segundo plano).
    await this.notifications.createMany(
      members.map((m) => ({
        organizationId: m.organizationId,
        userId: m.userId,
        title,
        body,
        type: 'PLATFORM_ANNOUNCEMENT',
      })),
    );
  }
}
