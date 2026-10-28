import { Injectable } from '@nestjs/common';
import { FeedPostingMode, FeedPostKind, FeedPostStatus, FeedReactionType, FeedReportStatus, FeedVisibility, OrgRole, Prisma, RecordStatus } from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateFeedPostDto, FEED_BODY_MAX, FeedListQueryDto, UpdateFeedPostDto, UpdateFeedSettingsDto } from './dto/feed.dto';
import { FeedAccessService, FeedTarget, FeedViewer, forbidden } from './feed-access';
import { badRequest, FeedErrorCode, invalidCursor, invalidState, postNotFound, tooMany } from './feed-errors';
import { deleteFeedFiles } from './feed-media-storage';
import { FEED_POST_SELECT, FeedPostRow, FeedPostView, FeedPresenter, ReactionSummary } from './feed-presenter';
import { detachMedia } from './feed-purge';
import { FeedNoticesService } from './feed-notices.service';
import { ageOn, cleanBlockedWords, containsBlockedWord, decodeCursor, encodeCursor, FeedCursor, isStoryLive, normalizeUserText, startOfDaySaoPaulo } from './feed-text';

export interface FeedSettingsView {
  enabled: boolean;
  postingMode: FeedPostingMode;
  canPost: boolean;
  allowComments: boolean;
  /** Para MIM: o meu proximo post vai para aprovacao (modo moderado para nao-equipe, ou menor de idade). */
  requiresApproval: boolean;
}

export interface FeedSettingsAdminView extends FeedSettingsView {
  blockedWords: string[];
}

export interface OrgFeedSettings {
  feedEnabled: boolean;
  feedPostingMode: FeedPostingMode;
  feedAllowComments: boolean;
  feedBlockedWords: string[];
}

/** Limite diario (dia civil SP) lido a cada chamada: FEED_POSTS_PER_DAY (10) / FEED_COMMENTS_PER_DAY (60). */
export function dailyLimit(name: 'FEED_POSTS_PER_DAY' | 'FEED_COMMENTS_PER_DAY', fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Cursor keyset da ordem (pinned desc, createdAt desc, id desc). */
export function feedCursorWhere(c: FeedCursor | null): Prisma.FeedPostWhereInput {
  if (!c) return {};
  return {
    OR: [
      { pinned: c.pinned, createdAt: c.createdAt, id: { lt: c.id } },
      { pinned: c.pinned, createdAt: { lt: c.createdAt } },
      ...(c.pinned ? [{ pinned: false }] : []),
    ],
  };
}

export const FEED_ORDER: Prisma.FeedPostOrderByWithRelationInput[] = [{ pinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];

/**
 * Feed do grupo (contrato secao 4): configuracoes, linha do tempo, posts e reacoes. Comentarios/denuncias em
 * FeedInteractionsService, moderacao em FeedModerationService, fotos em FeedMediaService. Toda leitura/escrita e
 * filtrada pelo grupo do TOKEN e pelas regras de FeedAccessService; post fora do alcance = o mesmo 404 do inexistente.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FeedAccessService,
    private readonly presenter: FeedPresenter,
    private readonly notices: FeedNoticesService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Configuracoes
  // ---------------------------------------------------------------------------------------------------------------

  async orgSettings(organizationId: number): Promise<OrgFeedSettings> {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { feedEnabled: true, feedPostingMode: true, feedAllowComments: true, feedBlockedWords: true },
    });
  }

  /** O feed esta ligado e ESTE usuario pode postar (403 FEED_DISABLED / POSTING_NOT_ALLOWED). */
  assertCanPost(v: FeedViewer, s: OrgFeedSettings): void {
    if (!s.feedEnabled) throw forbidden(FeedErrorCode.FEED_DISABLED, 'O feed do grupo está desligado.');
    if (s.feedPostingMode === FeedPostingMode.STAFF_ONLY && !v.isStaff) {
      throw forbidden(FeedErrorCode.POSTING_NOT_ALLOWED, 'Neste grupo só a equipe pode publicar no feed.');
    }
  }

  assertEnabled(s: OrgFeedSettings): void {
    if (!s.feedEnabled) throw forbidden(FeedErrorCode.FEED_DISABLED, 'O feed do grupo está desligado.');
  }

  /**
   * Menor de 18 pela data de nascimento da FICHA (Person) do autor; sem ficha, a da matricula no grupo. Sem nenhuma
   * data: ALUNO conta como menor (nao da para provar que e adulto: decisao conservadora); os demais papeis, adulto.
   */
  async isMinor(v: FeedViewer, now = new Date()): Promise<boolean> {
    const [person, student] = await Promise.all([
      this.prisma.person.findUnique({ where: { userId: v.userId }, select: { birthDate: true } }),
      this.prisma.student.findFirst({ where: { organizationId: v.organizationId, userId: v.userId }, select: { birthDate: true } }),
    ]);
    const birthDate = person?.birthDate ?? student?.birthDate ?? null;
    if (!birthDate) return v.role === OrgRole.ALUNO;
    return ageOn(birthDate, now) < 18;
  }

  /** O post deste usuario vai para aprovacao (sem contar palavra bloqueada)? */
  async requiresApproval(v: FeedViewer, s: OrgFeedSettings): Promise<boolean> {
    if (await this.isMinor(v)) return true;
    return s.feedPostingMode === FeedPostingMode.MODERATED && !v.isStaff;
  }

  /** Vai para aprovacao: regra do autor (menor, modo moderado) OU palavra bloqueada no texto/legenda. SSOT de post e story. */
  async needsApproval(v: FeedViewer, s: OrgFeedSettings, text: string | null): Promise<boolean> {
    return (await this.requiresApproval(v, s)) || containsBlockedWord(text, s.feedBlockedWords);
  }

  async getSettings(v: FeedViewer): Promise<FeedSettingsView> {
    const s = await this.orgSettings(v.organizationId);
    return this.settingsView(v, s);
  }

  private async settingsView(v: FeedViewer, s: OrgFeedSettings): Promise<FeedSettingsView> {
    return {
      enabled: s.feedEnabled,
      postingMode: s.feedPostingMode,
      canPost: s.feedEnabled && (s.feedPostingMode !== FeedPostingMode.STAFF_ONLY || v.isStaff),
      allowComments: s.feedAllowComments,
      requiresApproval: await this.requiresApproval(v, s),
    };
  }

  async getAdminSettings(v: FeedViewer): Promise<FeedSettingsAdminView> {
    const s = await this.orgSettings(v.organizationId);
    return { ...(await this.settingsView(v, s)), blockedWords: s.feedBlockedWords };
  }

  async updateSettings(v: FeedViewer, dto: UpdateFeedSettingsDto): Promise<FeedSettingsAdminView> {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.enabled !== undefined) data.feedEnabled = dto.enabled;
    if (dto.postingMode !== undefined) data.feedPostingMode = dto.postingMode;
    if (dto.allowComments !== undefined) data.feedAllowComments = dto.allowComments;
    if (dto.blockedWords !== undefined) data.feedBlockedWords = cleanBlockedWords(dto.blockedWords);
    await this.prisma.organization.update({ where: { id: v.organizationId }, data });
    await this.audit.record({
      organizationId: v.organizationId,
      action: AuditAction.FEED_SETTINGS_UPDATE,
      entity: AuditEntity.ORGANIZATION,
      entityId: v.organizationId,
      // Sem as palavras em si: so quais campos mudaram e quantas palavras ficaram.
      meta: {
        fields: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
        enabled: dto.enabled,
        postingMode: dto.postingMode,
        allowComments: dto.allowComments,
        blockedWordsCount: Array.isArray(data.feedBlockedWords) ? data.feedBlockedWords.length : undefined,
      },
    });
    return this.getAdminSettings(v);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Linha do tempo
  // ---------------------------------------------------------------------------------------------------------------

  async list(v: FeedViewer, query: FeedListQueryDto): Promise<{ items: FeedPostView[]; nextCursor: string | null }> {
    this.assertEnabled(await this.orgSettings(v.organizationId));
    const limit = query.limit ?? 15;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw invalidCursor();
    const rows = await this.prisma.feedPost.findMany({
      where: {
        AND: [
          // Stories tem a propria rota (GET /feed/stories): a linha do tempo e so de POST.
          { organizationId: v.organizationId, deletedAt: null, kind: FeedPostKind.POST },
          this.access.visibleWhere(v),
          // So PUBLISHED; o PENDING_APPROVAL so para o proprio autor. HIDDEN/REMOVED nunca aparecem aqui.
          { OR: [{ status: FeedPostStatus.PUBLISHED }, { status: FeedPostStatus.PENDING_APPROVAL, authorUserId: v.userId }] },
          feedCursorWhere(cursor),
        ],
      },
      select: FEED_POST_SELECT,
      orderBy: FEED_ORDER,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.presenter.present(v, page),
      nextCursor: rows.length > limit && last ? encodeCursor({ pinned: last.pinned, createdAt: last.createdAt, id: last.id }) : null,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Carga de um post por id (todas as acoes passam por aqui)
  // ---------------------------------------------------------------------------------------------------------------

  /** Post do grupo, nao removido, ou null. */
  async loadPost(v: FeedViewer, id: number): Promise<FeedPostRow | null> {
    return this.prisma.feedPost.findFirst({
      where: { id, organizationId: v.organizationId, deletedAt: null, status: { not: FeedPostStatus.REMOVED } },
      select: FEED_POST_SELECT,
    });
  }

  /** Visivel como MEMBRO: publicado e no alcance, ou pendente do proprio autor. */
  isVisible(v: FeedViewer, row: FeedPostRow): boolean {
    if (row.status === FeedPostStatus.PUBLISHED) return this.access.canSee(v, row);
    return row.status === FeedPostStatus.PENDING_APPROVAL && row.authorUserId === v.userId;
  }

  /**
   * Post PUBLICADO visivel (reagir, comentar, denunciar) ou 404. Story vencido = 404 (como o inexistente); story
   * vigente so passa com `allowStory` (denunciar): reagir/comentar em story = 409 INVALID_STATE (stories nao tem
   * reacao nem comentario). A ordem evita enumeracao: quem nao ve o story recebe o mesmo 404 de qualquer id.
   */
  async publishedVisible(v: FeedViewer, id: number, options: { allowStory?: boolean; now?: Date } = {}): Promise<FeedPostRow> {
    const row = await this.loadPost(v, id);
    if (!row || row.status !== FeedPostStatus.PUBLISHED || !this.access.canSee(v, row)) throw postNotFound();
    if (row.kind === FeedPostKind.STORY) {
      if (!isStoryLive(row, options.now)) throw postNotFound();
      if (!options.allowStory) throw invalidState('Stories não recebem reações nem comentários.');
    }
    return row;
  }

  async presentOne(v: FeedViewer, row: FeedPostRow): Promise<FeedPostView> {
    return (await this.presenter.present(v, [row]))[0];
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Posts
  // ---------------------------------------------------------------------------------------------------------------

  /** Valida a visibilidade escolhida contra o que o AUTOR pertence (IDOR): unidade/turma de outro grupo/inativa/alheia = 403. */
  async resolveTarget(
    v: FeedViewer,
    dto: Pick<CreateFeedPostDto, 'visibility' | 'unitId' | 'classId'>,
  ): Promise<{ visibility: FeedVisibility; unitId: number | null; classId: number | null }> {
    const denied = () => forbidden(FeedErrorCode.VISIBILITY_NOT_ALLOWED, 'Você não pode publicar para esse público.');
    if (dto.visibility === FeedVisibility.GROUP) {
      if (dto.unitId !== undefined || dto.classId !== undefined) throw badRequest(FeedErrorCode.VALIDATION, 'Post para todo o grupo não leva unidade nem turma.');
      return { visibility: FeedVisibility.GROUP, unitId: null, classId: null };
    }
    if (dto.visibility === FeedVisibility.UNIT) {
      if (dto.unitId === undefined) throw badRequest(FeedErrorCode.VALIDATION, 'Informe a unidade.');
      if (dto.classId !== undefined) throw badRequest(FeedErrorCode.VALIDATION, 'Post para a unidade não leva turma.');
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, organizationId: v.organizationId, status: RecordStatus.ACTIVE }, select: { id: true } });
      const target: FeedTarget = { visibility: FeedVisibility.UNIT, unitId: dto.unitId, classId: null };
      if (!unit || !this.access.belongsTo(v, target)) throw denied();
      return { visibility: FeedVisibility.UNIT, unitId: unit.id, classId: null };
    }
    if (dto.classId === undefined) throw badRequest(FeedErrorCode.VALIDATION, 'Informe a turma.');
    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, organizationId: v.organizationId, status: RecordStatus.ACTIVE },
      select: { id: true, unitId: true, teacherUserId: true },
    });
    if (!klass || !this.access.belongsTo(v, { visibility: FeedVisibility.CLASS, unitId: klass.unitId, classId: klass.id, class: klass })) throw denied();
    if (dto.unitId !== undefined && dto.unitId !== klass.unitId) throw badRequest(FeedErrorCode.VALIDATION, 'A unidade não é a da turma.');
    return { visibility: FeedVisibility.CLASS, unitId: klass.unitId, classId: klass.id };
  }

  async create(v: FeedViewer, dto: CreateFeedPostDto, now = new Date()): Promise<FeedPostView> {
    const s = await this.orgSettings(v.organizationId);
    this.assertCanPost(v, s);
    const body = normalizeUserText(dto.body);
    if (body && body.length > FEED_BODY_MAX) throw badRequest(FeedErrorCode.VALIDATION, `O texto pode ter até ${FEED_BODY_MAX} caracteres.`);
    const mediaIds = dto.mediaIds ?? [];
    if (!body && mediaIds.length === 0) throw badRequest(FeedErrorCode.VALIDATION, 'Escreva um texto ou envie uma foto.');
    const target = await this.resolveTarget(v, dto);

    // A cota de posts nao conta stories (eles tem a propria: FEED_STORIES_PER_DAY).
    const today = await this.prisma.feedPost.count({
      where: { organizationId: v.organizationId, authorUserId: v.userId, kind: FeedPostKind.POST, createdAt: { gte: startOfDaySaoPaulo(now) } },
    });
    if (today >= dailyLimit('FEED_POSTS_PER_DAY', 10)) throw tooMany(FeedErrorCode.POST_LIMIT, 'Você chegou ao limite de posts de hoje. Tente amanhã.');

    // Palavra bloqueada: vai para aprovacao SEM dizer o motivo (o autor so ve "aguardando aprovacao").
    const pending = await this.needsApproval(v, s, body);
    const person = await this.prisma.person.findUnique({ where: { userId: v.userId }, select: { id: true } });

    const created = await this.prisma.$transaction(async (tx) => {
      const post = await tx.feedPost.create({
        data: {
          organizationId: v.organizationId,
          authorUserId: v.userId,
          authorPersonId: person?.id ?? null,
          body,
          visibility: target.visibility,
          unitId: target.unitId,
          classId: target.classId,
          status: pending ? FeedPostStatus.PENDING_APPROVAL : FeedPostStatus.PUBLISHED,
        },
        select: { id: true },
      });
      if (mediaIds.length) {
        // So as fotos PENDENTES do proprio autor, deste grupo e nao expiradas; qualquer outra = 400 (sem dizer qual).
        const linked = await tx.feedPostMedia.updateMany({
          where: { id: { in: mediaIds }, organizationId: v.organizationId, uploaderUserId: v.userId, postId: null, pendingExpiresAt: { gt: now } },
          data: { postId: post.id, pendingExpiresAt: null },
        });
        if (linked.count !== mediaIds.length) throw badRequest(FeedErrorCode.MEDIA_INVALID, 'Alguma foto é inválida ou expirou. Envie de novo.');
        for (let i = 0; i < mediaIds.length; i++) await tx.feedPostMedia.update({ where: { id: mediaIds[i] }, data: { order: i } });
      }
      return post;
    });

    await this.audit.record({
      organizationId: v.organizationId,
      action: AuditAction.FEED_POST_CREATE,
      entity: AuditEntity.FEED_POST,
      entityId: created.id,
      meta: { visibility: target.visibility, unitId: target.unitId, classId: target.classId, status: pending ? 'PENDING_APPROVAL' : 'PUBLISHED', media: mediaIds.length },
    });
    const row = await this.loadPost(v, created.id);
    return this.presentOne(v, row as FeedPostRow);
  }

  /** Editar o TEXTO (so o autor). Volta para aprovacao se a regra pedir (menor, modo moderado, palavra bloqueada). */
  async update(v: FeedViewer, id: number, dto: UpdateFeedPostDto): Promise<FeedPostView> {
    const row = await this.loadPost(v, id);
    if (!row || (!this.isVisible(v, row) && !this.access.canModerate(v, row))) throw postNotFound();
    if (row.authorUserId !== v.userId || (row.status !== FeedPostStatus.PUBLISHED && row.status !== FeedPostStatus.PENDING_APPROVAL)) {
      throw forbidden(FeedErrorCode.FORBIDDEN, 'Só o autor pode editar o post.');
    }
    if (row.kind === FeedPostKind.STORY) throw invalidState('Stories não se editam: apague e publique de novo.');
    // Pendente NAO se edita: a aprovacao tem de valer para o texto que o moderador leu (sem trocar entre a fila e o
    // "aprovar"). O autor apaga e publica de novo.
    if (row.status === FeedPostStatus.PENDING_APPROVAL) throw invalidState('O post está aguardando aprovação e não pode ser editado agora.');
    const s = await this.orgSettings(v.organizationId);
    this.assertCanPost(v, s);
    const body = normalizeUserText(dto.body);
    if (body && body.length > FEED_BODY_MAX) throw badRequest(FeedErrorCode.VALIDATION, `O texto pode ter até ${FEED_BODY_MAX} caracteres.`);
    if (!body && (await this.prisma.feedPostMedia.count({ where: { postId: id } })) === 0) {
      throw badRequest(FeedErrorCode.VALIDATION, 'Escreva um texto ou mantenha uma foto.');
    }
    const pending = await this.needsApproval(v, s, body);
    // Pre-condicao no proprio UPDATE: se um moderador ocultou/removeu no meio, a edicao nao grava (409).
    const changed = await this.prisma.feedPost.updateMany({
      where: { id, status: FeedPostStatus.PUBLISHED, deletedAt: null },
      data: { body, edited: true, ...(pending ? { status: FeedPostStatus.PENDING_APPROVAL, pinned: false } : {}) },
    });
    if (changed.count !== 1) throw invalidState('O post mudou enquanto você editava. Recarregue.');
    return this.presentOne(v, (await this.loadPost(v, id)) as FeedPostRow);
  }

  /**
   * Apagar (autor ou moderador do post) = REMOVED: sai do feed, perde o texto e as fotos (linhas agora, arquivos depois
   * do commit); denuncias abertas viram ACTIONED. Moderador apagando post de outro avisa o autor (FEED_HIDDEN).
   */
  async remove(v: FeedViewer, id: number, now = new Date()): Promise<void> {
    const row = await this.loadPost(v, id);
    const isAuthor = !!row && row.authorUserId !== null && row.authorUserId === v.userId;
    const canModerate = !!row && this.access.canModerate(v, row);
    if (!row || (!isAuthor && !canModerate && !this.isVisible(v, row))) throw postNotFound();
    if (!isAuthor && !canModerate) throw forbidden(FeedErrorCode.FORBIDDEN, 'Você não pode apagar este post.');
    if (!isAuthor) await this.assertModeratorMayRemove(v, row);
    const keys = await this.removePost(id, v.userId, now);
    await deleteFeedFiles(keys);
    await this.audit.record({
      organizationId: v.organizationId,
      action: AuditAction.FEED_POST_DELETE,
      entity: AuditEntity.FEED_POST,
      entityId: id,
      meta: { by: isAuthor ? 'AUTHOR' : 'MODERATOR' },
    });
    if (!isAuthor) await this.notices.hidden(v.organizationId, id, row.authorUserId, v.userId, row.kind);
  }

  /** Algum desses usuarios e MESTRE (papel ATUAL no grupo)? */
  async anyMestre(organizationId: number, userIds: Array<number | null>): Promise<boolean> {
    const ids = userIds.filter((id): id is number => id !== null);
    if (ids.length === 0) return false;
    return (await this.prisma.organizationUser.count({ where: { organizationId, userId: { in: ids }, role: OrgRole.MESTRE } })) > 0;
  }

  /**
   * Hierarquia da moderacao: a remocao e IRREVERSIVEL, entao PROFESSOR/INSTRUTOR nao apaga de vez post de MESTRE nem post
   * que um MESTRE ocultou/recusou (o MESTRE decide). O proprio autor sempre pode apagar o seu.
   */
  async assertModeratorMayRemove(v: FeedViewer, row: Pick<FeedPostRow, 'authorUserId' | 'hiddenById'>): Promise<void> {
    if (v.isMestre || (row.authorUserId !== null && row.authorUserId === v.userId)) return;
    if (await this.anyMestre(v.organizationId, [row.authorUserId, row.hiddenById])) {
      throw forbidden(FeedErrorCode.MODERATION_NOT_ALLOWED, 'Só o Mestre pode apagar este post.');
    }
  }

  /** Marca REMOVED e solta a midia (transacao); devolve as chaves para apagar do disco depois do commit. */
  async removePost(id: number, actorUserId: number, now: Date): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.feedPost.update({ where: { id }, data: { status: FeedPostStatus.REMOVED, deletedAt: now, pinned: false, body: null } });
      // Story: quem viu nao precisa mais ser lembrado (no post a tabela fica vazia).
      await tx.feedStoryView.deleteMany({ where: { postId: id } });
      await tx.feedReport.updateMany({
        where: { OR: [{ postId: id }, { comment: { postId: id } }], status: FeedReportStatus.OPEN },
        data: { status: FeedReportStatus.ACTIONED, resolvedById: actorUserId, resolvedAt: now },
      });
      return detachMedia(tx, { postId: id });
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Reacoes
  // ---------------------------------------------------------------------------------------------------------------

  async react(v: FeedViewer, id: number, type: FeedReactionType | null): Promise<ReactionSummary> {
    this.assertEnabled(await this.orgSettings(v.organizationId));
    const row = await this.publishedVisible(v, id);
    let created: Date | null = null;
    if (type === null) {
      await this.prisma.feedReaction.deleteMany({ where: { postId: id, userId: v.userId } });
    } else {
      const existing = await this.prisma.feedReaction.findUnique({ where: { postId_userId: { postId: id, userId: v.userId } }, select: { type: true } });
      if (!existing) {
        try {
          created = (await this.prisma.feedReaction.create({ data: { postId: id, userId: v.userId, type }, select: { createdAt: true } })).createdAt;
        } catch (error) {
          // Corrida com outro pedido do mesmo usuario: o unico [postId,userId] segura; vira troca de tipo.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
          await this.prisma.feedReaction.upsert({
            where: { postId_userId: { postId: id, userId: v.userId } },
            create: { postId: id, userId: v.userId, type },
            update: { type },
          });
        }
      } else if (existing.type !== type) {
        await this.prisma.feedReaction.updateMany({ where: { postId: id, userId: v.userId }, data: { type } });
      }
    }
    // So reacao NOVA notifica (trocar o tipo/remover nao); a janela comeca no instante gravado da reacao.
    if (created) await this.notices.activity(v.organizationId, id, row.authorUserId, v.userId, 'REACTION', created);
    return (await this.presenter.reactions([id], v.userId)).get(id) as ReactionSummary;
  }
}
