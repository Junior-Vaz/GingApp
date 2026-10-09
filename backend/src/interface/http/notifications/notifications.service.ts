import { Injectable, NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { LimitOffsetQueryDto, Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Notificações são sempre pessoais (por userId), nunca por organização — um usuário só
 * enxerga (e só pode marcar como lida) a própria notificação. Não há @CanAccess aqui: a
 * segurança vem da query sempre filtrar por userId do token, não de uma checagem de papel.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mais recentes primeiro (`id` desempata => paginação determinística). Paginado: limit/offset,
   * total de notificações do usuário em X-Total-Count. */
  async findAllForUser(userId: number, query: LimitOffsetQueryDto = {}): Promise<Page<Notification>> {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Retorna `{ count }`, não um número puro — achado empírico (PLANO_PROJETO.md §10.11):
   * um controller do Nest que devolve um primitivo (number/string) faz o Express responder
   * com `Content-Type: text/html`, não `application/json` (Nest só chama `res.json()` para
   * valores tipo objeto/array). Isso quebra qualquer cliente que dependa do content-type para
   * decidir se faz parse como JSON (ex.: superagent/supertest) — envolver num objeto evita a
   * ambiguidade e fica consistente com `markAllAsRead`, que já retorna `{ count }`.
   */
  async countUnreadForUser(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markAsRead(userId: number, id: number) {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    if (notification.readAt) {
      return notification;
    }
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllAsRead(userId: number) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
