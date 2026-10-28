import { FeedCommentStatus, FeedPostKind, FeedPostStatus, FeedReportStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
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

/** Folga entre o vencimento do story (`expiresAt`) e a remocao pelo cron: a foto ja deixou de ser servida no vencimento. */
export const STORY_PURGE_GRACE_MS = 60 * 60 * 1000;
const STORY_PURGE_BATCH = 200;
const STORY_PURGE_MAX_BATCHES = 25;

/**
 * Limpeza de stories vencidos (cron do feed): os que venceram ha mais de 1 h (`expiresAt + 1h <= now`) e ainda nao estao
 * REMOVED viram REMOVED (sem legenda), perdem as visualizacoes (`FeedStoryView`) e as fotos (linhas na transacao; os
 * ARQUIVOS so depois do commit). Denuncias abertas viram DISMISSED (o conteudo expirou sozinho). `organizationId` limita
 * (so para os testes). Devolve quantos stories foram removidos.
 */
export async function purgeExpiredStories(prisma: Pick<PrismaService, 'feedPost' | '$transaction'>, now: Date, organizationId?: number): Promise<number> {
  const cutoff = new Date(now.getTime() - STORY_PURGE_GRACE_MS);
  let total = 0;
  for (let round = 0; round < STORY_PURGE_MAX_BATCHES; round++) {
    const stale = await prisma.feedPost.findMany({
      where: {
        ...(organizationId !== undefined ? { organizationId } : {}),
        kind: FeedPostKind.STORY,
        status: { not: FeedPostStatus.REMOVED },
        expiresAt: { lte: cutoff },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: STORY_PURGE_BATCH,
    });
    if (stale.length === 0) break;
    const ids = stale.map((s) => s.id);
    const keys = await prisma.$transaction(async (tx) => {
      await tx.feedPost.updateMany({
        where: { id: { in: ids }, kind: FeedPostKind.STORY, status: { not: FeedPostStatus.REMOVED } },
        data: { status: FeedPostStatus.REMOVED, deletedAt: now, pinned: false, body: null, hiddenReason: 'EXPIRED' },
      });
      await tx.feedReport.updateMany({ where: { postId: { in: ids }, status: FeedReportStatus.OPEN }, data: { status: FeedReportStatus.DISMISSED, resolvedAt: now } });
      await tx.feedStoryView.deleteMany({ where: { postId: { in: ids } } });
      return detachMedia(tx, { postId: { in: ids } });
    });
    await deleteFeedFiles(keys); // disco SO depois do commit
    total += ids.length;
    if (stale.length < STORY_PURGE_BATCH) break;
  }
  return total;
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
 * LGPD (AnonymizationService, pedido de exclusao): dentro da transacao do chamador, os posts (e stories) e comentarios do titular
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
  // Stories: os do titular ja entraram em `posts` acima (REMOVED, sem legenda, foto apagada); o que ELE viu de outros some.
  await tx.feedStoryView.deleteMany({ where: { userId } });
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
