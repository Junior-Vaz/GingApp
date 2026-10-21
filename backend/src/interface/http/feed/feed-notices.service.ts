import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Janela de agrupamento das notificacoes de atividade de um post. */
export const FEED_ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

export const FeedNotificationType = {
  ACTIVITY: 'FEED_ACTIVITY',
  APPROVED: 'FEED_APPROVED',
  HIDDEN: 'FEED_HIDDEN',
} as const;

/**
 * Notificacoes do feed, SEMPRE pelo NotificationsService (SSOT). Atividade (reacao NOVA ou comentario de outra pessoa no
 * post do autor) vira UMA notificacao por post por janela de 30 min (FeedActivityNotice): dentro da janela so o texto
 * da mesma notificacao muda ("Fulano e mais N pessoas interagiram") e ela volta a "nao lida", sem novo push. Quem
 * interage no proprio post nunca gera aviso; trocar o tipo de reacao ou remover tambem nao. Tudo aqui e efeito
 * colateral: falha vira log, nunca derruba a acao.
 */
@Injectable()
export class FeedNoticesService {
  private readonly logger = new Logger(FeedNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async activity(organizationId: number, postId: number, postAuthorUserId: number | null, actorUserId: number, kind: 'REACTION' | 'COMMENT', now = new Date()): Promise<void> {
    if (postAuthorUserId === null || postAuthorUserId === actorUserId) return;
    try {
      const cutoff = new Date(now.getTime() - FEED_ACTIVITY_WINDOW_MS);
      const notice = await this.prisma.feedActivityNotice.findUnique({ where: { postId_authorUserId: { postId, authorUserId: postAuthorUserId } } });
      const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { name: true, person: { select: { name: true, nickname: true } } } });
      const actorName = actor?.person?.nickname || actor?.person?.name || actor?.name || 'Alguém';

      if (notice && notice.notificationId !== null && notice.windowStartedAt.getTime() > cutoff.getTime()) {
        const others = await this.distinctActors(postId, postAuthorUserId, notice.windowStartedAt, actorUserId);
        const content = this.content(actorName, others, kind);
        const kept = await this.notifications.refreshGrouped(notice.notificationId, postAuthorUserId, { ...content, data: { postId, actorUserId } });
        if (kept) {
          await this.prisma.feedActivityNotice.update({ where: { id: notice.id }, data: { count: others + 1, lastActorUserId: actorUserId } });
          return;
        }
      }
      // Nova janela (ou a notificacao anterior sumiu): nova Notification, contador zerado.
      const notificationId = await this.notifications.createGrouped(organizationId, postAuthorUserId, {
        type: FeedNotificationType.ACTIVITY,
        ...this.content(actorName, 0, kind),
        // actorUserId: o nome dele vai no texto; a anonimizacao (LGPD) acha e neutraliza por aqui.
        data: { postId, actorUserId },
      });
      await this.prisma.feedActivityNotice.upsert({
        where: { postId_authorUserId: { postId, authorUserId: postAuthorUserId } },
        create: { postId, authorUserId: postAuthorUserId, windowStartedAt: now, count: 1, lastActorUserId: actorUserId, notificationId },
        update: { windowStartedAt: now, count: 1, lastActorUserId: actorUserId, notificationId },
      });
    } catch (error) {
      this.logger.error(`Falha ao notificar atividade do post ${postId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Outras pessoas (distintas, fora o autor e o ator atual) que reagiram/comentaram desde o inicio da janela. */
  private async distinctActors(postId: number, authorUserId: number, since: Date, actorUserId: number): Promise<number> {
    const [reactions, comments] = await Promise.all([
      this.prisma.feedReaction.findMany({ where: { postId, createdAt: { gte: since }, userId: { notIn: [authorUserId, actorUserId] } }, select: { userId: true } }),
      this.prisma.feedComment.findMany({
        where: { postId, createdAt: { gte: since }, authorUserId: { notIn: [authorUserId, actorUserId] } },
        select: { authorUserId: true },
        distinct: ['authorUserId'],
      }),
    ]);
    return new Set([...reactions.map((r) => r.userId), ...comments.map((c) => c.authorUserId as number)]).size;
  }

  private content(actorName: string, others: number, kind: 'REACTION' | 'COMMENT'): { title: string; body: string } {
    const body =
      others === 0
        ? kind === 'REACTION'
          ? `${actorName} reagiu ao seu post.`
          : `${actorName} comentou no seu post.`
        : others === 1
          ? `${actorName} e mais 1 pessoa interagiu com o seu post.`
          : `${actorName} e mais ${others} pessoas interagiram com o seu post.`;
    return { title: 'Atividade no seu post', body };
  }

  /** Post aprovado pelo moderador. */
  async approved(organizationId: number, postId: number, authorUserId: number | null): Promise<void> {
    if (authorUserId === null) return;
    await this.notifications.safely('feed.approved', () =>
      this.notifications.notifyUsers(organizationId, [authorUserId], {
        type: FeedNotificationType.APPROVED,
        title: 'Seu post foi publicado',
        body: 'Seu post foi aprovado e já aparece no feed do grupo.',
        data: { postId },
      }),
    );
  }

  /** Post ocultado/removido/recusado por um moderador (texto neutro, sem culpar). */
  async hidden(organizationId: number, postId: number, authorUserId: number | null, actorUserId: number): Promise<void> {
    if (authorUserId === null || authorUserId === actorUserId) return;
    await this.notifications.safely('feed.hidden', () =>
      this.notifications.notifyUsers(organizationId, [authorUserId], {
        type: FeedNotificationType.HIDDEN,
        title: 'Seu post não está visível no feed',
        body: 'A moderação do grupo revisou o seu post e ele não aparece mais no feed.',
        data: { postId },
      }),
    );
  }
}
