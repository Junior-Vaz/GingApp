import { Injectable } from '@nestjs/common';
import { FeedCommentStatus, FeedPostStatus, FeedReportStatus, OrgRole, Prisma } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateFeedCommentDto, FEED_COMMENT_MAX, FEED_REPORT_NOTE_MAX, FeedCommentsQueryDto, ReportDto } from './dto/feed.dto';
import { FeedAccessService, FeedViewer, forbidden } from './feed-access';
import { badRequest, commentNotFound, FeedErrorCode, invalidCursor, postNotFound, tooMany } from './feed-errors';
import { AUTHOR_SELECT, FeedAuthor, FeedPresenter } from './feed-presenter';
import { FeedNoticesService } from './feed-notices.service';
import { dailyLimit, FeedService } from './feed.service';
import { normalizeUserText, startOfDaySaoPaulo } from './feed-text';

/** Denuncias DISTINTAS (abertas) que ocultam o alvo ate um moderador decidir. */
export const AUTO_HIDE_REPORTS = 3;

export interface FeedCommentView {
  id: number;
  parentId: number | null;
  author: FeedAuthor | null;
  body: string | null;
  createdAt: Date;
  canDelete: boolean;
}

const COMMENT_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  authorUserId: true,
  body: true,
  status: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
} satisfies Prisma.FeedCommentSelect;

type CommentRow = Prisma.FeedCommentGetPayload<{ select: typeof COMMENT_SELECT }>;

/** Cursor dos comentarios (ordem cronologica crescente): `<epochMs>.<id>` em base64url. */
function encodeCommentCursor(c: { createdAt: Date; id: number }): string {
  return Buffer.from(`${c.createdAt.getTime()}.${c.id}`, 'utf8').toString('base64url');
}

function decodeCommentCursor(raw: string): { createdAt: Date; id: number } | null {
  const m = /^(\d{1,15})\.(\d{1,10})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!m) return null;
  const id = Number(m[2]);
  if (id < 1 || id > 2_147_483_647) return null;
  return { createdAt: new Date(Number(m[1])), id };
}

/** Comentarios (um nivel de resposta) e denuncias de post/comentario. */
@Injectable()
export class FeedInteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FeedAccessService,
    private readonly feed: FeedService,
    private readonly presenter: FeedPresenter,
    private readonly notices: FeedNoticesService,
    private readonly audit: AuditService,
  ) {}

  /** Comentarios de um post visivel (o moderador do post tambem le, mesmo pendente/oculto). */
  async listComments(v: FeedViewer, postId: number, query: FeedCommentsQueryDto): Promise<{ items: FeedCommentView[]; nextCursor: string | null }> {
    // Feed desligado: membro nao le; o moderador continua lendo (painel). Apagar o proprio conteudo segue permitido.
    if (!v.isModerator) this.feed.assertEnabled(await this.feed.orgSettings(v.organizationId));
    const row = await this.feed.loadPost(v, postId);
    if (!row || (!this.feed.isVisible(v, row) && !this.access.canModerate(v, row))) throw postNotFound();
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCommentCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw invalidCursor();
    const rows = await this.prisma.feedComment.findMany({
      where: {
        postId,
        organizationId: v.organizationId,
        status: FeedCommentStatus.PUBLISHED,
        deletedAt: null,
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      select: COMMENT_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const canModerate = this.access.canModerate(v, row);
    const roles = await this.presenter.roles(v.organizationId, page.map((c) => c.authorUserId).filter((id): id is number => id !== null));
    const last = page[page.length - 1];
    return {
      items: page.map((c) => this.commentView(v, c, roles, canModerate)),
      nextCursor: rows.length > limit && last ? encodeCommentCursor(last) : null,
    };
  }

  private commentView(v: FeedViewer, c: CommentRow, roles: Map<number, OrgRole>, canModerate: boolean): FeedCommentView {
    return {
      id: c.id,
      parentId: c.parentId,
      author: this.presenter.author(c.author, roles),
      body: c.body,
      createdAt: c.createdAt,
      canDelete: (c.authorUserId !== null && c.authorUserId === v.userId) || canModerate,
    };
  }

  async createComment(v: FeedViewer, postId: number, dto: CreateFeedCommentDto, now = new Date()): Promise<FeedCommentView> {
    const s = await this.feed.orgSettings(v.organizationId);
    this.feed.assertEnabled(s);
    const post = await this.feed.publishedVisible(v, postId);
    if (!s.feedAllowComments) throw forbidden(FeedErrorCode.COMMENTS_DISABLED, 'Os comentários estão desligados neste grupo.');
    const body = normalizeUserText(dto.body);
    if (!body) throw badRequest(FeedErrorCode.VALIDATION, 'Escreva o comentário.');
    if (body.length > FEED_COMMENT_MAX) throw badRequest(FeedErrorCode.VALIDATION, `O comentário pode ter até ${FEED_COMMENT_MAX} caracteres.`);
    if (dto.parentId !== undefined) {
      // Um nivel so: a resposta aponta para um comentario RAIZ publicado do mesmo post.
      const parent = await this.prisma.feedComment.findFirst({
        where: { id: dto.parentId, postId, organizationId: v.organizationId, parentId: null, status: FeedCommentStatus.PUBLISHED, deletedAt: null },
        select: { id: true },
      });
      if (!parent) throw badRequest(FeedErrorCode.VALIDATION, 'Só é possível responder a um comentário do post (um nível).');
    }
    const today = await this.prisma.feedComment.count({ where: { organizationId: v.organizationId, authorUserId: v.userId, createdAt: { gte: startOfDaySaoPaulo(now) } } });
    if (today >= dailyLimit('FEED_COMMENTS_PER_DAY', 60)) throw tooMany(FeedErrorCode.COMMENT_LIMIT, 'Você chegou ao limite de comentários de hoje.');
    const created = await this.prisma.feedComment.create({
      data: { organizationId: v.organizationId, postId, parentId: dto.parentId ?? null, authorUserId: v.userId, body },
      select: COMMENT_SELECT,
    });
    // A janela comeca no instante gravado da propria atividade (relogio do banco), para ela entrar na contagem.
    await this.notices.activity(v.organizationId, postId, post.authorUserId, v.userId, 'COMMENT', created.createdAt);
    const roles = await this.presenter.roles(v.organizationId, [v.userId]);
    return this.commentView(v, created, roles, this.access.canModerate(v, post));
  }

  /** Apagar comentario: autor ou moderador do post. Sai da lista e perde o texto. */
  async deleteComment(v: FeedViewer, commentId: number, now = new Date()): Promise<void> {
    const c = await this.prisma.feedComment.findFirst({
      where: { id: commentId, organizationId: v.organizationId, deletedAt: null, status: { not: FeedCommentStatus.REMOVED } },
      select: { id: true, postId: true, authorUserId: true, status: true },
    });
    const post = c ? await this.feed.loadPost(v, c.postId) : null;
    if (!c || !post) throw commentNotFound();
    const isAuthor = c.authorUserId !== null && c.authorUserId === v.userId;
    const canModerate = this.access.canModerate(v, post);
    if (!isAuthor && !canModerate) {
      if (!this.feed.isVisible(v, post) || c.status !== FeedCommentStatus.PUBLISHED) throw commentNotFound();
      throw forbidden(FeedErrorCode.FORBIDDEN, 'Você não pode apagar este comentário.');
    }
    await this.prisma.$transaction([
      this.prisma.feedComment.update({ where: { id: c.id }, data: { status: FeedCommentStatus.REMOVED, deletedAt: now, body: null } }),
      this.prisma.feedReport.updateMany({
        where: { commentId: c.id, status: FeedReportStatus.OPEN },
        data: { status: FeedReportStatus.ACTIONED, resolvedById: v.userId, resolvedAt: now },
      }),
    ]);
    if (!isAuthor) {
      await this.audit.record({
        organizationId: v.organizationId,
        action: AuditAction.FEED_COMMENT_DELETE,
        entity: AuditEntity.FEED_COMMENT,
        entityId: c.id,
        meta: { postId: c.postId, by: 'MODERATOR' },
      });
    }
  }

  /**
   * Denunciar um post visivel. Uma por usuario por alvo (a repeticao devolve {ok:true} sem gravar nada). 3 denuncias
   * DISTINTAS abertas ocultam o post (HIDDEN, motivo REPORTS) ate um moderador decidir. O proprio autor nao denuncia.
   */
  async reportPost(v: FeedViewer, postId: number, dto: ReportDto): Promise<{ ok: true }> {
    this.feed.assertEnabled(await this.feed.orgSettings(v.organizationId));
    const post = await this.feed.publishedVisible(v, postId);
    if (post.authorUserId === v.userId) throw badRequest(FeedErrorCode.VALIDATION, 'Você não pode denunciar o seu próprio post.');
    const created = await this.createReport(v, { postId }, dto);
    if (!created) return { ok: true };
    const open = await this.prisma.feedReport.count({ where: { postId, status: FeedReportStatus.OPEN, reporterUserId: { not: null } } });
    let autoHidden = false;
    if (open >= AUTO_HIDE_REPORTS) {
      const hid = await this.prisma.feedPost.updateMany({
        where: { id: postId, status: FeedPostStatus.PUBLISHED },
        // Sem `pinned: false`: se as denuncias forem arquivadas (DISMISS) o post volta ao feed ainda fixado.
        data: { status: FeedPostStatus.HIDDEN, hiddenReason: 'REPORTS', hiddenById: null },
      });
      autoHidden = hid.count === 1;
    }
    // Denunciante protegido: a trilha (visivel ao Mestre em /audit-logs/me-group) nao leva usuario nem IP dele.
    await this.audit.record({
      organizationId: v.organizationId,
      userId: null,
      ip: null,
      action: AuditAction.FEED_POST_REPORT,
      entity: AuditEntity.FEED_POST,
      entityId: postId,
      meta: { target: 'POST', reason: dto.reason, autoHidden },
    });
    return { ok: true };
  }

  async reportComment(v: FeedViewer, commentId: number, dto: ReportDto): Promise<{ ok: true }> {
    this.feed.assertEnabled(await this.feed.orgSettings(v.organizationId));
    const c =await this.prisma.feedComment.findFirst({
      where: { id: commentId, organizationId: v.organizationId, status: FeedCommentStatus.PUBLISHED, deletedAt: null },
      select: { id: true, postId: true, authorUserId: true },
    });
    const post = c ? await this.feed.loadPost(v, c.postId) : null;
    if (!c || !post || post.status !== FeedPostStatus.PUBLISHED || !this.access.canSee(v, post)) throw commentNotFound();
    if (c.authorUserId === v.userId) throw badRequest(FeedErrorCode.VALIDATION, 'Você não pode denunciar o seu próprio comentário.');
    const created = await this.createReport(v, { commentId }, dto);
    if (!created) return { ok: true };
    const open = await this.prisma.feedReport.count({ where: { commentId, status: FeedReportStatus.OPEN, reporterUserId: { not: null } } });
    let autoHidden = false;
    if (open >= AUTO_HIDE_REPORTS) {
      const hid = await this.prisma.feedComment.updateMany({
        where: { id: commentId, status: FeedCommentStatus.PUBLISHED },
        data: { status: FeedCommentStatus.HIDDEN, hiddenById: null },
      });
      autoHidden = hid.count === 1;
    }
    await this.audit.record({
      organizationId: v.organizationId,
      userId: null,
      ip: null,
      action: AuditAction.FEED_POST_REPORT,
      entity: AuditEntity.FEED_COMMENT,
      entityId: commentId,
      meta: { target: 'COMMENT', postId: c.postId, reason: dto.reason, autoHidden },
    });
    return { ok: true };
  }

  /** Grava a denuncia; false se o usuario ja denunciou este alvo (unico [reporterUserId, alvo]). */
  private async createReport(v: FeedViewer, target: { postId?: number; commentId?: number }, dto: ReportDto): Promise<boolean> {
    const note = normalizeUserText(dto.note, false);
    // Checagem antes (evita o log de erro do Prisma no caso comum); o unico segura a corrida.
    if (await this.prisma.feedReport.findFirst({ where: { reporterUserId: v.userId, ...target }, select: { id: true } })) return false;
    try {
      await this.prisma.feedReport.create({
        data: {
          organizationId: v.organizationId,
          reporterUserId: v.userId,
          reason: dto.reason,
          note: note ? note.slice(0, FEED_REPORT_NOTE_MAX) : null,
          ...target,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }
}
