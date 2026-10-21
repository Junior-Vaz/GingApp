import { FeedCommentStatus, FeedPostStatus, Prisma } from '@prisma/client';
import { deleteFeedFiles } from './feed-media-storage';
import { FeedNotificationType } from './feed-notices.service';

type Tx = Prisma.TransactionClient;
const FEED_ACTIVITY_TYPE = FeedNotificationType.ACTIVITY;
type Db = Pick<Prisma.TransactionClient, 'feedPostMedia'>;

/**
 * Apaga as LINHAS de midia que casam com `where` e devolve as chaves (foto + miniatura) para o chamador apagar do disco
 * DEPOIS do commit (`deleteFeedFiles`). Usado na remocao de post, na anonimizacao LGPD e na limpeza agendada.
 */
export async function detachMedia(db: Db, where: Prisma.FeedPostMediaWhereInput): Promise<string[]> {
  const rows = await db.feedPostMedia.findMany({ where, select: { id: true, storageKey: true, thumbKey: true } });
  if (rows.length === 0) return [];
  await db.feedPostMedia.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.flatMap((r) => [r.storageKey, r.thumbKey]);
}

/** Midia (linhas + arquivos) de posts REMOVED: rede de seguranca da remocao (o fluxo normal ja apaga na hora). */
export async function purgeRemovedPostsMedia(db: Db, organizationId?: number): Promise<number> {
  const keys = await detachMedia(db, {
    ...(organizationId !== undefined ? { organizationId } : {}),
    post: { status: FeedPostStatus.REMOVED },
  });
  await deleteFeedFiles(keys);
  return keys.length / 2;
}

export interface FeedAnonymizationResult {
  posts: number;
  comments: number;
  reactions: number;
  media: number;
  /** Chaves a apagar do disco depois do commit. */
  storageKeys: string[];
}

/**
 * LGPD (AnonymizationService, pedido de exclusao): dentro da transacao do chamador, os posts e comentarios do titular
 * perdem autor e texto (`author:null`, `body:null`) e saem do feed (REMOVED); as fotos (dos posts dele e as pendentes
 * enviadas por ele) perdem a linha aqui e o ARQUIVO depois do commit; reacoes dele sao apagadas; denuncias feitas por
 * ele perdem o denunciante e a nota; agrupamentos de aviso dele somem. Denuncias/comentarios de OUTRAS pessoas ficam.
 */
export async function anonymizeFeedForUser(tx: Tx, userId: number, personIds: number[], now: Date): Promise<FeedAnonymizationResult> {
  const postWhere: Prisma.FeedPostWhereInput = { OR: [{ authorUserId: userId }, ...(personIds.length ? [{ authorPersonId: { in: personIds } }] : [])] };
  const posts = await tx.feedPost.findMany({ where: postWhere, select: { id: true } });
  const postIds = posts.map((p) => p.id);
  const storageKeys = await detachMedia(tx, { OR: [{ uploaderUserId: userId }, ...(postIds.length ? [{ postId: { in: postIds } }] : [])] });
  if (postIds.length) {
    await tx.feedPost.updateMany({
      where: { id: { in: postIds } },
      data: { authorUserId: null, authorPersonId: null, body: null, status: FeedPostStatus.REMOVED, pinned: false, deletedAt: now, hiddenReason: 'ANONYMIZED' },
    });
  }
  const comments = await tx.feedComment.updateMany({
    where: { authorUserId: userId },
    data: { authorUserId: null, body: null, status: FeedCommentStatus.REMOVED, deletedAt: now },
  });
  const reactions = await tx.feedReaction.deleteMany({ where: { userId } });
  await tx.feedReport.updateMany({ where: { reporterUserId: userId }, data: { reporterUserId: null, note: null } });
  await tx.feedActivityNotice.deleteMany({ where: { authorUserId: userId } });
  await tx.feedActivityNotice.updateMany({ where: { lastActorUserId: userId }, data: { lastActorUserId: null } });
  // Avisos de atividade de OUTRAS pessoas cujo texto traz o nome do titular ("Fulano reagiu..."): texto neutro.
  const named = await tx.notification.findMany({
    where: { type: FEED_ACTIVITY_TYPE, data: { path: ['actorUserId'], equals: userId } },
    select: { id: true, data: true },
  });
  for (const n of named) {
    const postId = (n.data as { postId?: unknown } | null)?.postId;
    await tx.notification.update({
      where: { id: n.id },
      data: { body: 'Alguém interagiu com o seu post.', data: typeof postId === 'number' ? { postId } : Prisma.DbNull },
    });
  }
  return { posts: postIds.length, comments: comments.count, reactions: reactions.count, media: storageKeys.length / 2, storageKeys };
}
