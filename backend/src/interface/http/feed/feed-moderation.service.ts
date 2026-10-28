import { Injectable } from '@nestjs/common';
import { FeedCommentStatus, FeedPostKind, FeedPostStatus, FeedReportReason, FeedReportStatus, Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ModerationKind, ModerationQueueQueryDto, ResolveReportsDto } from './dto/feed.dto';
import { FeedAccessService, FeedViewer, forbidden } from './feed-access';
import { commentNotFound, FeedErrorCode, invalidCursor, invalidState, postNotFound } from './feed-errors';
import { deleteFeedFiles } from './feed-media-storage';
import { AUTHOR_SELECT, FEED_POST_SELECT, FeedAuthor, FeedPostRow, FeedPostView, FeedPresenter } from './feed-presenter';
import { FeedNoticesService } from './feed-notices.service';
import { FEED_ORDER, feedCursorWhere, FeedService } from './feed.service';
import { decodeCursor, encodeCursor, isStoryLive } from './feed-text';

export interface ModerationReport {
  reason: FeedReportReason;
  note: string | null;
  createdAt: Date;
}

export interface ModerationComment {
  id: number;
  parentId: number | null;
  author: FeedAuthor | null;
  body: string | null;
  status: FeedCommentStatus;
  createdAt: Date;
}

export interface ModerationItem {
  post: FeedPostView;
  comment?: ModerationComment;
  /** Denuncias ABERTAS (sem quem denunciou: o denunciante fica protegido). */
  reports: ModerationReport[];
  reportsCount: number;
}

const encodeReportCursor = (minId: number) => Buffer.from(`r.${minId}`, 'utf8').toString('base64url');
function decodeReportCursor(raw: string): number | null {
  const m = /^r\.(\d{1,10})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  return m ? Number(m[1]) : null;
}

/**
 * Moderacao (painel): fila PENDING/REPORTED/HIDDEN e acoes. MESTRE modera tudo; PROFESSOR/INSTRUTOR so posts
 * UNIT/CLASS do proprio escopo de unidade (FeedAccessService); demais papeis 403. Post de outro grupo/fora do alcance =
 * 404; visivel mas fora do poder de moderar = 403.
 */
@Injectable()
export class FeedModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FeedAccessService,
    private readonly feed: FeedService,
    private readonly presenter: FeedPresenter,
    private readonly notices: FeedNoticesService,
    private readonly audit: AuditService,
  ) {}

  async queue(v: FeedViewer, query: ModerationQueueQueryDto): Promise<{ items: ModerationItem[]; nextCursor: string | null }> {
    this.access.assertModerator(v);
    const kind: ModerationKind = query.kind ?? 'PENDING';
    const limit = query.limit ?? 15;
    return kind === 'REPORTED' ? this.reportedQueue(v, limit, query.cursor) : this.statusQueue(v, kind, limit, query.cursor);
  }

  private async statusQueue(v: FeedViewer, kind: 'PENDING' | 'HIDDEN', limit: number, rawCursor?: string) {
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) throw invalidCursor();
    const rows = await this.prisma.feedPost.findMany({
      where: {
        AND: [
          { organizationId: v.organizationId, deletedAt: null, status: kind === 'PENDING' ? FeedPostStatus.PENDING_APPROVAL : FeedPostStatus.HIDDEN },
          // A fila INCLUI stories (o item traz `kind`/`expiresAt`); story pendente que ja venceu nao ha o que aprovar.
          ...(kind === 'PENDING' ? [{ OR: [{ kind: FeedPostKind.POST }, { expiresAt: { gt: new Date() } }] }] : []),
          this.access.moderatableWhere(v) ?? { id: -1 },
          feedCursorWhere(cursor),
        ],
      },
      select: FEED_POST_SELECT,
      orderBy: FEED_ORDER,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const reports = await this.openReports(page.map((p) => ({ postId: p.id })));
    const posts = await this.presenter.present(v, page);
    const last = page[page.length - 1];
    return {
      items: posts.map((post) => {
        const list = reports.get(`p${post.id}`) ?? [];
        return { post, reports: list, reportsCount: list.length };
      }),
      nextCursor: rows.length > limit && last ? encodeCursor({ pinned: last.pinned, createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  /** Alvos (post ou comentario) com denuncia ABERTA, do mais recente para o mais antigo (pela 1a denuncia). */
  private async reportedQueue(v: FeedViewer, limit: number, rawCursor?: string) {
    const cursorId = rawCursor ? decodeReportCursor(rawCursor) : null;
    if (rawCursor && cursorId === null) throw invalidCursor();
    const mod = this.access.moderatableWhere(v) ?? { id: -1 };
    const alive: Prisma.FeedPostWhereInput = { AND: [mod, { status: { not: FeedPostStatus.REMOVED }, deletedAt: null }] };
    const groups = await this.prisma.feedReport.groupBy({
      by: ['postId', 'commentId'],
      where: {
        organizationId: v.organizationId,
        status: FeedReportStatus.OPEN,
        OR: [{ post: alive }, { comment: { status: { not: FeedCommentStatus.REMOVED }, post: alive } }],
      },
      _min: { id: true },
      _count: { _all: true },
      ...(cursorId !== null ? { having: { id: { _min: { lt: cursorId } } } } : {}),
      orderBy: { _min: { id: 'desc' } },
      take: limit + 1,
    });
    const page = groups.slice(0, limit);
    const commentIds = page.map((g) => g.commentId).filter((id): id is number => id !== null);
    const comments = commentIds.length
      ? await this.prisma.feedComment.findMany({
          where: { id: { in: commentIds } },
          select: { id: true, postId: true, parentId: true, authorUserId: true, body: true, status: true, createdAt: true, author: { select: AUTHOR_SELECT } },
        })
      : [];
    const commentById = new Map(comments.map((c) => [c.id, c]));
    const postIds = [...new Set(page.map((g) => g.postId ?? commentById.get(g.commentId as number)?.postId).filter((id): id is number => id !== undefined && id !== null))];
    const postRows = await this.prisma.feedPost.findMany({ where: { id: { in: postIds } }, select: FEED_POST_SELECT });
    const posts = new Map((await this.presenter.present(v, postRows)).map((p) => [p.id, p]));
    const reports = await this.openReports(page.map((g) => (g.commentId !== null ? { commentId: g.commentId } : { postId: g.postId as number })));
    const roles = await this.presenter.roles(v.organizationId, comments.map((c) => c.authorUserId).filter((id): id is number => id !== null));
    const items: ModerationItem[] = [];
    for (const g of page) {
      if (g.commentId !== null) {
        const c = commentById.get(g.commentId);
        const post = c ? posts.get(c.postId) : undefined;
        if (!c || !post) continue;
        const list = reports.get(`c${c.id}`) ?? [];
        items.push({
          post,
          comment: { id: c.id, parentId: c.parentId, author: this.presenter.author(c.author, roles), body: c.body, status: c.status, createdAt: c.createdAt },
          reports: list,
          reportsCount: list.length,
        });
      } else {
        const post = posts.get(g.postId as number);
        if (!post) continue;
        const list = reports.get(`p${post.id}`) ?? [];
        items.push({ post, reports: list, reportsCount: list.length });
      }
    }
    const last = page[page.length - 1];
    return { items, nextCursor: groups.length > limit && last?._min.id ? encodeReportCursor(last._min.id) : null };
  }

  /** Denuncias abertas por alvo (`p<id>` / `c<id>`), sem o denunciante. */
  private async openReports(targets: Array<{ postId?: number; commentId?: number }>): Promise<Map<string, ModerationReport[]>> {
    const out = new Map<string, ModerationReport[]>();
    const postIds = targets.map((t) => t.postId).filter((id): id is number => id !== undefined);
    const commentIds = targets.map((t) => t.commentId).filter((id): id is number => id !== undefined);
    if (!postIds.length && !commentIds.length) return out;
    const rows = await this.prisma.feedReport.findMany({
      where: { status: FeedReportStatus.OPEN, OR: [...(postIds.length ? [{ postId: { in: postIds } }] : []), ...(commentIds.length ? [{ commentId: { in: commentIds } }] : [])] },
      select: { postId: true, commentId: true, reason: true, note: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) {
      const key = r.commentId !== null ? `c${r.commentId}` : `p${r.postId}`;
      const list = out.get(key) ?? [];
      list.push({ reason: r.reason, note: r.note, createdAt: r.createdAt });
      out.set(key, list);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Acoes
  // ---------------------------------------------------------------------------------------------------------------

  /** Post moderavel por este usuario (404 fora do alcance; 403 visivel mas sem poder de moderar). */
  private async target(v: FeedViewer, id: number): Promise<FeedPostRow> {
    this.access.assertModerator(v);
    const row = await this.feed.loadPost(v, id);
    if (!row) throw postNotFound();
    if (!this.access.canModerate(v, row)) {
      if (this.feed.isVisible(v, row)) throw forbidden(FeedErrorCode.FORBIDDEN, 'Você não pode moderar este post.');
      throw postNotFound();
    }
    return row;
  }

  private async reload(v: FeedViewer, id: number): Promise<FeedPostView> {
    const row = await this.prisma.feedPost.findUniqueOrThrow({ where: { id }, select: FEED_POST_SELECT });
    return this.feed.presentOne(v, row);
  }

  private closeReports(postId: number, status: FeedReportStatus, actorUserId: number, now: Date) {
    return this.prisma.feedReport.updateMany({
      where: { postId, status: FeedReportStatus.OPEN },
      data: { status, resolvedById: actorUserId, resolvedAt: now },
    });
  }

  private record(v: FeedViewer, action: string, postId: number, meta?: Record<string, unknown>) {
    return this.audit.record({ organizationId: v.organizationId, action, entity: AuditEntity.FEED_POST, entityId: postId, meta });
  }

  async approve(v: FeedViewer, id: number, now = new Date()): Promise<FeedPostView> {
    const row = await this.target(v, id);
    if (row.status !== FeedPostStatus.PENDING_APPROVAL) throw invalidState('Só um post aguardando aprovação pode ser aprovado.');
    if (!isStoryLive(row, now)) throw invalidState('Este story já expirou.');
    // Pre-condicao no UPDATE (o autor pode ter apagado no meio).
    const ok = await this.prisma.feedPost.updateMany({
      where: { id, status: FeedPostStatus.PENDING_APPROVAL, deletedAt: null },
      data: { status: FeedPostStatus.PUBLISHED, approvedById: v.userId, approvedAt: now, hiddenReason: null, hiddenById: null },
    });
    if (ok.count !== 1) throw invalidState('Só um post aguardando aprovação pode ser aprovado.');
    await this.record(v, AuditAction.FEED_POST_APPROVE, id);
    await this.notices.approved(v.organizationId, id, row.authorUserId, row.kind);
    return this.reload(v, id);
  }

  async hide(v: FeedViewer, id: number, now = new Date(), reason = 'MODERATOR'): Promise<FeedPostView> {
    const row = await this.target(v, id);
    if (row.status !== FeedPostStatus.PUBLISHED && row.status !== FeedPostStatus.PENDING_APPROVAL && !(row.status === FeedPostStatus.HIDDEN && row.hiddenReason === 'REPORTS')) {
      throw invalidState('Este post já está oculto.');
    }
    await this.prisma.feedPost.update({ where: { id }, data: { status: FeedPostStatus.HIDDEN, hiddenReason: reason, hiddenById: v.userId, pinned: false } });
    await this.closeReports(id, FeedReportStatus.ACTIONED, v.userId, now);
    await this.record(v, AuditAction.FEED_POST_HIDE, id, { from: row.status, reason });
    await this.notices.hidden(v.organizationId, id, row.authorUserId, v.userId, row.kind);
    return this.reload(v, id);
  }

  async restore(v: FeedViewer, id: number, now = new Date()): Promise<FeedPostView> {
    const row = await this.target(v, id);
    if (row.status !== FeedPostStatus.HIDDEN) throw invalidState('Só um post oculto pode ser restaurado.');
    // Hierarquia: o que um MESTRE ocultou/recusou so o MESTRE devolve ao feed (o professor nao republica foto de crianca).
    if (!v.isMestre && (await this.feed.anyMestre(v.organizationId, [row.hiddenById]))) {
      throw forbidden(FeedErrorCode.MODERATION_NOT_ALLOWED, 'Só o Mestre pode restaurar um post que o Mestre ocultou.');
    }
    // Restaurar vale como aprovacao (o post pode ter sido recusado ainda pendente).
    await this.prisma.feedPost.update({ where: { id }, data: { status: FeedPostStatus.PUBLISHED, hiddenReason: null, hiddenById: null, approvedById: v.userId, approvedAt: now } });
    await this.closeReports(id, FeedReportStatus.DISMISSED, v.userId, now);
    await this.record(v, AuditAction.FEED_POST_RESTORE, id);
    return this.reload(v, id);
  }

  async setPinned(v: FeedViewer, id: number, pinned: boolean): Promise<FeedPostView> {
    const row = await this.target(v, id);
    if (pinned && row.kind === FeedPostKind.STORY) throw invalidState('Stories não podem ser fixados.');
    if (pinned && row.status !== FeedPostStatus.PUBLISHED) throw invalidState('Só um post publicado pode ser fixado.');
    if (row.pinned !== pinned) {
      await this.prisma.feedPost.update({ where: { id }, data: { pinned } });
      await this.record(v, AuditAction.FEED_POST_PIN, id, { pinned });
    }
    return this.reload(v, id);
  }

  /**
   * Decide as denuncias de um post (ou, com `commentId`, de um comentario dele): DISMISS arquiva (e devolve ao feed o
   * que foi ocultado SO pelas denuncias); HIDE oculta; REMOVE remove (post: texto e fotos apagados).
   */
  async resolve(v: FeedViewer, postId: number, dto: ResolveReportsDto, now = new Date()): Promise<{ ok: true }> {
    const row = await this.target(v, postId);
    if (dto.commentId !== undefined) return this.resolveComment(v, row, dto, now);
    if (dto.action === 'HIDE') {
      if (row.status !== FeedPostStatus.HIDDEN || row.hiddenReason === 'REPORTS') await this.hide(v, postId, now);
      else await this.closeReports(postId, FeedReportStatus.ACTIONED, v.userId, now);
      return { ok: true };
    }
    if (dto.action === 'REMOVE') {
      await this.feed.assertModeratorMayRemove(v, row);
      const keys = await this.feed.removePost(postId, v.userId, now);
      await deleteFeedFiles(keys);
      await this.record(v, AuditAction.FEED_POST_DELETE, postId, { by: 'MODERATOR', via: 'REPORTS' });
      await this.notices.hidden(v.organizationId, postId, row.authorUserId, v.userId, row.kind);
      return { ok: true };
    }
    await this.closeReports(postId, FeedReportStatus.DISMISSED, v.userId, now);
    if (row.status === FeedPostStatus.HIDDEN && row.hiddenReason === 'REPORTS') {
      // So o que as DENUNCIAS ocultaram volta (hiddenReason REPORTS = ocultacao automatica); o `pinned` ficou preservado.
      await this.prisma.feedPost.update({ where: { id: postId }, data: { status: FeedPostStatus.PUBLISHED, hiddenReason: null, hiddenById: null } });
      await this.record(v, AuditAction.FEED_POST_RESTORE, postId, { via: 'REPORTS_DISMISSED' });
    }
    return { ok: true };
  }

  private async resolveComment(v: FeedViewer, post: FeedPostRow, dto: ResolveReportsDto, now: Date): Promise<{ ok: true }> {
    const c = await this.prisma.feedComment.findFirst({
      where: { id: dto.commentId, postId: post.id, organizationId: v.organizationId, status: { not: FeedCommentStatus.REMOVED } },
      select: { id: true, status: true, hiddenById: true },
    });
    if (!c) throw commentNotFound();
    const reportStatus = dto.action === 'DISMISS' ? FeedReportStatus.DISMISSED : FeedReportStatus.ACTIONED;
    let data: Prisma.FeedCommentUpdateInput = {};
    if (dto.action === 'REMOVE') data = { status: FeedCommentStatus.REMOVED, deletedAt: now, body: null };
    else if (dto.action === 'HIDE') data = { status: FeedCommentStatus.HIDDEN, hiddenById: v.userId };
    else if (c.status === FeedCommentStatus.HIDDEN && c.hiddenById === null) {
      // DISMISS so republica o que as DENUNCIAS ocultaram (hiddenById nulo) e que ainda tem denuncia ABERTA; o que um
      // moderador ocultou segue oculto (e DISMISS repetido nao republica nada).
      const open = await this.prisma.feedReport.count({ where: { commentId: c.id, status: FeedReportStatus.OPEN } });
      if (open > 0) data = { status: FeedCommentStatus.PUBLISHED };
    }
    await this.prisma.$transaction([
      this.prisma.feedComment.update({ where: { id: c.id }, data }),
      this.prisma.feedReport.updateMany({ where: { commentId: c.id, status: FeedReportStatus.OPEN }, data: { status: reportStatus, resolvedById: v.userId, resolvedAt: now } }),
    ]);
    const action = dto.action === 'REMOVE' ? AuditAction.FEED_COMMENT_DELETE : dto.action === 'HIDE' ? AuditAction.FEED_POST_HIDE : AuditAction.FEED_POST_RESTORE;
    await this.audit.record({ organizationId: v.organizationId, action, entity: AuditEntity.FEED_COMMENT, entityId: c.id, meta: { postId: post.id, resolve: dto.action } });
    return { ok: true };
  }
}
