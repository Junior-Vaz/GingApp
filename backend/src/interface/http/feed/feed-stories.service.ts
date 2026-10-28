import { Injectable } from '@nestjs/common';
import { FeedPostKind, FeedPostStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateFeedStoryDto, FEED_STORY_CAPTION_MAX } from './dto/feed.dto';
import { FeedAccessService, FeedViewer } from './feed-access';
import { badRequest, FeedErrorCode, storyNotFound, tooMany } from './feed-errors';
import { FEED_POST_SELECT, FeedAuthor, FeedMediaView, FeedPostRow, FeedPostView, FeedPresenter } from './feed-presenter';
import { FeedService } from './feed.service';
import { isStoryLive, normalizeUserText, startOfDaySaoPaulo, storiesPerDay, storyTtlHours } from './feed-text';

export interface StoryItemView {
  id: number;
  media: FeedMediaView;
  caption: string | null;
  createdAt: Date;
  expiresAt: Date;
  seen: boolean;
  status: 'PUBLISHED' | 'PENDING_APPROVAL';
}

export interface StoryGroupView {
  author: FeedAuthor | null;
  isMine: boolean;
  hasUnseen: boolean;
  /** Do mais antigo para o mais novo. */
  items: StoryItemView[];
}

/** Teto de stories lidos por chamada (a janela de 24-48 h de um grupo; os mais novos ganham se passar disso). */
const MAX_STORIES_LISTED = 500;

/**
 * Stories do feed (contrato secao 9): FeedPost com kind=STORY (UMA foto + legenda <= 140, expira em
 * FEED_STORY_TTL_HOURS). Reaproveita as regras do feed: visibilidade (FeedAccessService), status por modo de postagem /
 * menor / palavra bloqueada (FeedService.needsApproval), IDOR de unidade/turma (FeedService.resolveTarget), foto privada
 * com URL assinada (FeedPresenter.mediaByPost), moderacao e LGPD (mesmas rotas e a mesma anonimizacao dos posts).
 */
@Injectable()
export class FeedStoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FeedAccessService,
    private readonly feed: FeedService,
    private readonly presenter: FeedPresenter,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stories vigentes e visiveis a ESTE usuario, agrupados por autor. Meu grupo primeiro; depois quem tem story nao visto
   * (mais recente primeiro); depois os ja vistos. Itens do mais antigo para o mais novo. Consultas fixas (stories, fotos,
   * vistos, papeis): sem N+1.
   */
  async list(v: FeedViewer, now = new Date()): Promise<{ groups: StoryGroupView[] }> {
    this.feed.assertEnabled(await this.feed.orgSettings(v.organizationId));
    const newestFirst = await this.prisma.feedPost.findMany({
      where: {
        AND: [
          { organizationId: v.organizationId, deletedAt: null, kind: FeedPostKind.STORY, expiresAt: { gt: now } },
          this.access.visibleWhere(v),
          // Publicado; o pendente so para o proprio autor (como no feed). HIDDEN/REMOVED nunca.
          { OR: [{ status: FeedPostStatus.PUBLISHED }, { status: FeedPostStatus.PENDING_APPROVAL, authorUserId: v.userId }] },
        ],
      },
      select: FEED_POST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_STORIES_LISTED,
    });
    const rows = newestFirst.reverse();
    if (rows.length === 0) return { groups: [] };
    const ids = rows.map((r) => r.id);
    const [mediaByPost, viewed, roles] = await Promise.all([
      this.presenter.mediaByPost(v, new Map(rows.map((r) => [r.id, r.status]))),
      this.prisma.feedStoryView.findMany({ where: { userId: v.userId, postId: { in: ids } }, select: { postId: true } }),
      this.presenter.roles(v.organizationId, rows.map((r) => r.authorUserId).filter((id): id is number => id !== null)),
    ]);
    const seenIds = new Set(viewed.map((x) => x.postId));

    const byAuthor = new Map<number, { group: StoryGroupView; latest: number }>();
    for (const row of rows) {
      const media = mediaByPost.get(row.id)?.[0];
      if (!media) continue; // story sem foto nao existe (o POST exige a foto); defesa contra linha quebrada
      const key = row.authorUserId ?? 0;
      let entry = byAuthor.get(key);
      if (!entry) {
        entry = { group: { author: this.presenter.author(row.author, roles), isMine: row.authorUserId !== null && row.authorUserId === v.userId, hasUnseen: false, items: [] }, latest: 0 };
        byAuthor.set(key, entry);
      }
      // O autor nao precisa marcar o proprio story: sempre "visto" para ele.
      const seen = entry.group.isMine || seenIds.has(row.id);
      if (!seen) entry.group.hasUnseen = true;
      entry.latest = Math.max(entry.latest, row.createdAt.getTime());
      entry.group.items.push({
        id: row.id,
        media,
        caption: row.body,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt as Date,
        seen,
        status: row.status === FeedPostStatus.PENDING_APPROVAL ? 'PENDING_APPROVAL' : 'PUBLISHED',
      });
    }
    const rank = (g: StoryGroupView) => (g.isMine ? 0 : g.hasUnseen ? 1 : 2);
    const groups = [...byAuthor.entries()]
      .sort(([ka, a], [kb, b]) => rank(a.group) - rank(b.group) || b.latest - a.latest || ka - kb)
      .map(([, e]) => e.group);
    return { groups };
  }

  /**
   * Publica um story. Mesmas regras do post: feed ligado, modo de postagem (STAFF_ONLY nao-equipe = 403), IDOR da
   * visibilidade (403), menor de 18 SEMPRE pendente, modo moderado para nao-equipe, palavra bloqueada na legenda -> pendente
   * (sem dizer o motivo). A foto tem de existir, ser do autor, deste grupo, pendente e nao usada (senao 400 MEDIA_INVALID).
   */
  async create(v: FeedViewer, dto: CreateFeedStoryDto, now = new Date()): Promise<FeedPostView> {
    const s = await this.feed.orgSettings(v.organizationId);
    this.feed.assertCanPost(v, s);
    const caption = normalizeUserText(dto.caption, false);
    if (caption && caption.length > FEED_STORY_CAPTION_MAX) {
      throw badRequest(FeedErrorCode.VALIDATION, `A legenda pode ter até ${FEED_STORY_CAPTION_MAX} caracteres.`);
    }
    const target = await this.feed.resolveTarget(v, dto);

    const today = await this.prisma.feedPost.count({
      where: { organizationId: v.organizationId, authorUserId: v.userId, kind: FeedPostKind.STORY, createdAt: { gte: startOfDaySaoPaulo(now) } },
    });
    if (today >= storiesPerDay()) throw tooMany(FeedErrorCode.STORY_LIMIT, 'Você chegou ao limite de stories de hoje. Tente amanhã.');

    const pending = await this.feed.needsApproval(v, s, caption);
    const person = await this.prisma.person.findUnique({ where: { userId: v.userId }, select: { id: true } });
    const expiresAt = new Date(now.getTime() + storyTtlHours() * 60 * 60 * 1000);

    const created = await this.prisma.$transaction(async (tx) => {
      const post = await tx.feedPost.create({
        data: {
          organizationId: v.organizationId,
          authorUserId: v.userId,
          authorPersonId: person?.id ?? null,
          kind: FeedPostKind.STORY,
          expiresAt,
          body: caption,
          visibility: target.visibility,
          unitId: target.unitId,
          classId: target.classId,
          status: pending ? FeedPostStatus.PENDING_APPROVAL : FeedPostStatus.PUBLISHED,
        },
        select: { id: true },
      });
      // So a foto PENDENTE do proprio autor, deste grupo e nao expirada; qualquer outra = 400 (sem dizer qual).
      const linked = await tx.feedPostMedia.updateMany({
        where: { id: dto.mediaId, organizationId: v.organizationId, uploaderUserId: v.userId, postId: null, pendingExpiresAt: { gt: now } },
        data: { postId: post.id, pendingExpiresAt: null, order: 0 },
      });
      if (linked.count !== 1) throw badRequest(FeedErrorCode.MEDIA_INVALID, 'A foto é inválida ou expirou. Envie de novo.');
      return post;
    });

    await this.audit.record({
      organizationId: v.organizationId,
      action: AuditAction.FEED_STORY_CREATE,
      entity: AuditEntity.FEED_POST,
      entityId: created.id,
      // Sem a legenda nem a foto: so ids, alcance, status e validade.
      meta: { visibility: target.visibility, unitId: target.unitId, classId: target.classId, status: pending ? 'PENDING_APPROVAL' : 'PUBLISHED', expiresAt: expiresAt.toISOString() },
    });
    const row = await this.feed.loadPost(v, created.id);
    return this.feed.presentOne(v, row as FeedPostRow);
  }

  /**
   * Marca o story como visto (idempotente). So story VIGENTE e VISIVEL a este usuario; qualquer outra coisa (inexistente,
   * de outro grupo, fora do alcance, pendente/oculto de outro, vencido, ou que nem e story) = o MESMO 404. O autor nao precisa
   * marcar o proprio: 204 sem gravar.
   */
  async markViewed(v: FeedViewer, id: number, now = new Date()): Promise<void> {
    this.feed.assertEnabled(await this.feed.orgSettings(v.organizationId));
    const row = await this.feed.loadPost(v, id);
    if (!row || row.kind !== FeedPostKind.STORY || !isStoryLive(row, now)) throw storyNotFound();
    const mine = row.authorUserId !== null && row.authorUserId === v.userId;
    const visible = mine
      ? row.status === FeedPostStatus.PUBLISHED || row.status === FeedPostStatus.PENDING_APPROVAL
      : row.status === FeedPostStatus.PUBLISHED && this.access.canSee(v, row);
    if (!visible) throw storyNotFound();
    if (mine) return;
    // createMany + skipDuplicates: idempotente sem erro/log de unico (duas chamadas concorrentes tambem passam).
    await this.prisma.feedStoryView.createMany({ data: [{ postId: id, userId: v.userId }], skipDuplicates: true });
  }
}
