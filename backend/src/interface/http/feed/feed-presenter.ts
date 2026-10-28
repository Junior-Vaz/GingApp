import { Injectable } from '@nestjs/common';
import { FeedCommentStatus, FeedPostKind, FeedPostStatus, FeedReactionType, FeedVisibility, OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FeedAccessService, FeedViewer } from './feed-access';
import { mediaExpiry, signedMediaUrl } from './feed-media-storage';

/** Campos de post que a apresentacao e as regras de acesso precisam (um select so, sem N+1). */
export const FEED_POST_SELECT = {
  id: true,
  organizationId: true,
  authorUserId: true,
  body: true,
  visibility: true,
  unitId: true,
  classId: true,
  status: true,
  kind: true,
  expiresAt: true,
  pinned: true,
  edited: true,
  hiddenReason: true,
  hiddenById: true,
  createdAt: true,
  author: { select: { id: true, name: true, photo: true, person: { select: { name: true, nickname: true, photo: true } } } },
  class: { select: { unitId: true, teacherUserId: true } },
} satisfies Prisma.FeedPostSelect;

export type FeedPostRow = Prisma.FeedPostGetPayload<{ select: typeof FEED_POST_SELECT }>;

export const AUTHOR_SELECT = { id: true, name: true, photo: true, person: { select: { name: true, nickname: true, photo: true } } } satisfies Prisma.UserSelect;
export type AuthorRow = Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>;

export const REACTION_TYPES: FeedReactionType[] = [
  FeedReactionType.AXE,
  FeedReactionType.SALVE,
  FeedReactionType.GINGA,
  FeedReactionType.PARABENS,
  FeedReactionType.CORACAO,
];

export interface FeedAuthor {
  userId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  roleLabel: string | null;
}

export interface ReactionSummary {
  counts: Record<FeedReactionType, number>;
  total: number;
  mine: FeedReactionType | null;
}

export interface FeedMediaView {
  id: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

/** Comentario de 1o nivel mostrado dentro do cartao do feed (estilo Instagram). Mesmo formato publico de `GET /feed/posts/:id/comments`, sem `canDelete`. */
export interface FeedRecentComment {
  id: number;
  parentId: null;
  author: FeedAuthor | null;
  body: string;
  createdAt: Date;
}

/** Quantos comentarios recentes cada cartao do feed carrega. */
export const FEED_RECENT_COMMENTS = 2;

export interface FeedPostView {
  id: number;
  type: 'POST';
  /** POST (publicacao) ou STORY (foto + legenda em `body`, que expira em `expiresAt`). */
  kind: FeedPostKind;
  /** So STORY; nulo em POST. */
  expiresAt: Date | null;
  author: FeedAuthor | null;
  body: string | null;
  media: FeedMediaView[];
  visibility: FeedVisibility;
  unitId: number | null;
  classId: number | null;
  pinned: boolean;
  status: FeedPostStatus;
  createdAt: Date;
  edited: boolean;
  reactions: ReactionSummary;
  commentsCount: number;
  /** Ate 2 comentarios de 1o nivel PUBLICADOS, os mais recentes, em ordem cronologica (o mais antigo dos dois primeiro). */
  recentComments: FeedRecentComment[];
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
}

/** Rotulo do papel no grupo (so a equipe; aluno/responsavel = null, sem expor mais nada). */
const ROLE_LABEL: Partial<Record<OrgRole, string>> = {
  [OrgRole.MESTRE]: 'Mestre',
  [OrgRole.PROFESSOR]: 'Professor',
  [OrgRole.INSTRUTOR]: 'Instrutor',
  [OrgRole.MONITOR]: 'Monitor',
};

export function emptyCounts(): Record<FeedReactionType, number> {
  return { AXE: 0, SALVE: 0, GINGA: 0, PARABENS: 0, CORACAO: 0 };
}

@Injectable()
export class FeedPresenter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: FeedAccessService,
  ) {}

  /** Autor publico: nome/apelido/foto da ficha (Person) ou do login; nunca e-mail, telefone, nascimento ou idade. */
  author(row: AuthorRow | null, roles: Map<number, OrgRole>): FeedAuthor | null {
    if (!row) return null;
    const role = roles.get(row.id);
    return {
      userId: row.id,
      name: row.person?.name ?? row.name,
      nickname: row.person?.nickname ?? null,
      photo: row.person?.photo ?? row.photo ?? null,
      roleLabel: role ? (ROLE_LABEL[role] ?? null) : null,
    };
  }

  /** Papel ATUAL no grupo de cada autor (uma consulta). */
  async roles(organizationId: number, userIds: number[]): Promise<Map<number, OrgRole>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.organizationUser.findMany({ where: { organizationId, userId: { in: ids } }, select: { userId: true, role: true } });
    return new Map(rows.map((r) => [r.userId, r.role]));
  }

  /** Contagens de reacao de varios posts (groupBy, sem N+1) e a reacao do usuario. */
  async reactions(postIds: number[], userId: number): Promise<Map<number, ReactionSummary>> {
    const out = new Map<number, ReactionSummary>();
    for (const id of postIds) out.set(id, { counts: emptyCounts(), total: 0, mine: null });
    if (postIds.length === 0) return out;
    const [grouped, mine] = await Promise.all([
      this.prisma.feedReaction.groupBy({ by: ['postId', 'type'], where: { postId: { in: postIds } }, _count: { _all: true } }),
      this.prisma.feedReaction.findMany({ where: { postId: { in: postIds }, userId }, select: { postId: true, type: true } }),
    ]);
    for (const g of grouped) {
      const s = out.get(g.postId);
      if (!s) continue;
      s.counts[g.type] = g._count._all;
      s.total += g._count._all;
    }
    for (const m of mine) {
      const s = out.get(m.postId);
      if (s) s.mine = m.type;
    }
    return out;
  }

  /**
   * Fotos assinadas de varios posts/stories (uma consulta). Post ainda nao aprovado / oculto (so o autor ou o moderador o
   * recebem): URL `review`, curta; publicado: URL de membro. SSOT do feed e dos stories.
   */
  async mediaByPost(v: FeedViewer, statusById: Map<number, FeedPostStatus>): Promise<Map<number, FeedMediaView[]>> {
    const ids = [...statusById.keys()];
    const mediaByPost = new Map<number, FeedMediaView[]>();
    if (ids.length === 0) return mediaByPost;
    const media = await this.prisma.feedPostMedia.findMany({
      where: { postId: { in: ids } },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true, postId: true, width: true, height: true },
    });
    const expiry = mediaExpiry();
    const reviewExpiry = mediaExpiry(Date.now(), undefined, 'review');
    for (const m of media) {
      if (m.postId === null) continue;
      const list = mediaByPost.get(m.postId) ?? [];
      const review = statusById.get(m.postId) !== FeedPostStatus.PUBLISHED;
      const e = review ? reviewExpiry : expiry;
      const scope = review ? 'review' : 'member';
      list.push({
        id: m.id,
        url: signedMediaUrl(v.organizationId, m.id, 'full', e, undefined, scope),
        thumbUrl: signedMediaUrl(v.organizationId, m.id, 'thumb', e, undefined, scope),
        width: m.width,
        height: m.height,
      });
      mediaByPost.set(m.postId, list);
    }
    return mediaByPost;
  }

  /**
   * Os 2 ultimos comentarios de 1o nivel (parentId nulo), PUBLISHED, nao apagados e com texto, de cada post POST publicado
   * da pagina: UMA consulta (ROW_NUMBER por post) + autores e papeis em lote (sem N+1). Mesmas regras de
   * `GET /feed/posts/:id/comments`: so chega aqui post que o usuario ja pode ver; oculto/removido/anonimizado (REMOVED) nunca
   * entra; autor anonimizado = `author:null`. Comentarios desligados no grupo, story, post pendente/oculto = lista vazia.
   * Ordem de saida: cronologica (o mais antigo dos dois primeiro).
   */
  async recentComments(v: FeedViewer, rows: FeedPostRow[]): Promise<Map<number, FeedRecentComment[]>> {
    const out = new Map<number, FeedRecentComment[]>();
    const postIds = rows.filter((r) => r.kind === FeedPostKind.POST && r.status === FeedPostStatus.PUBLISHED).map((r) => r.id);
    if (postIds.length === 0) return out;
    const org = await this.prisma.organization.findUnique({ where: { id: v.organizationId }, select: { feedAllowComments: true } });
    if (!org?.feedAllowComments) return out;
    const found = await this.prisma.$queryRaw<Array<{ id: number; postId: number; authorUserId: number | null; body: string; createdAt: Date }>>(Prisma.sql`
      SELECT t."id", t."postId", t."authorUserId", t."body", t."createdAt"
      FROM (
        SELECT c."id", c."postId", c."authorUserId", c."body", c."createdAt",
               ROW_NUMBER() OVER (PARTITION BY c."postId" ORDER BY c."createdAt" DESC, c."id" DESC) AS rn
        FROM "FeedComment" c
        WHERE c."postId" IN (${Prisma.join(postIds)})
          AND c."organizationId" = ${v.organizationId}
          AND c."parentId" IS NULL
          AND c."status" = 'PUBLISHED'::"FeedCommentStatus"
          AND c."deletedAt" IS NULL
          AND c."body" IS NOT NULL
      ) t
      WHERE t.rn <= ${FEED_RECENT_COMMENTS}
      ORDER BY t."postId" ASC, t."createdAt" ASC, t."id" ASC
    `);
    if (found.length === 0) return out;
    const authorIds = [...new Set(found.map((c) => c.authorUserId).filter((id): id is number => id !== null))];
    const [users, roles] = await Promise.all([
      authorIds.length ? this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: AUTHOR_SELECT }) : Promise.resolve([] as AuthorRow[]),
      this.roles(v.organizationId, authorIds),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    for (const c of found) {
      const list = out.get(c.postId) ?? [];
      list.push({
        id: c.id,
        parentId: null,
        author: c.authorUserId === null ? null : this.author(userById.get(c.authorUserId) ?? null, roles),
        body: c.body,
        createdAt: c.createdAt,
      });
      out.set(c.postId, list);
    }
    return out;
  }

  /** Monta os FeedPost (midia assinada, contagens, permissoes calculadas para ESTE usuario). */
  async present(v: FeedViewer, rows: FeedPostRow[]): Promise<FeedPostView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [mediaByPost, reactions, comments, roles, recent] = await Promise.all([
      this.mediaByPost(v, new Map(rows.map((r) => [r.id, r.status]))),
      this.reactions(ids, v.userId),
      this.prisma.feedComment.groupBy({
        by: ['postId'],
        where: { postId: { in: ids }, status: FeedCommentStatus.PUBLISHED, deletedAt: null },
        _count: { _all: true },
      }),
      this.roles(v.organizationId, rows.map((r) => r.authorUserId).filter((id): id is number => id !== null)),
      this.recentComments(v, rows),
    ]);
    const commentCount = new Map(comments.map((c) => [c.postId, c._count._all]));
    return rows.map((r) => {
      const isAuthor = r.authorUserId !== null && r.authorUserId === v.userId;
      const canModerate = this.access.canModerate(v, r);
      const alive = r.status !== FeedPostStatus.REMOVED;
      return {
        id: r.id,
        type: 'POST' as const,
        kind: r.kind,
        expiresAt: r.kind === FeedPostKind.STORY ? r.expiresAt : null,
        author: this.author(r.author, roles),
        body: r.body,
        media: mediaByPost.get(r.id) ?? [],
        visibility: r.visibility,
        unitId: r.unitId,
        classId: r.classId,
        pinned: r.pinned,
        status: r.status,
        createdAt: r.createdAt,
        edited: r.edited,
        reactions: reactions.get(r.id) ?? { counts: emptyCounts(), total: 0, mine: null },
        commentsCount: commentCount.get(r.id) ?? 0,
        recentComments: recent.get(r.id) ?? [],
        // So POST PUBLISHED edita (o PATCH de um post pendente devolve 409; story nao se edita: apaga e publica de novo).
        canEdit: isAuthor && r.status === FeedPostStatus.PUBLISHED && r.kind === FeedPostKind.POST,
        canDelete: alive && (isAuthor || canModerate),
        canModerate,
      };
    });
  }
}
