/** Tipos do feed do grupo (contrato: docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md, seção 4). */

export type Id = number | string;

export type FeedVisibility = "GROUP" | "UNIT" | "CLASS";
export type FeedStatus = "PUBLISHED" | "PENDING_APPROVAL" | "HIDDEN" | "REMOVED";
export type PostingMode = "ALL" | "STAFF_ONLY" | "MODERATED";
export type QueueKind = "PENDING" | "REPORTED" | "HIDDEN";
export type ReportReason = "OFENSIVO" | "IMPROPRIO" | "SPAM" | "MENOR" | "OUTRO";

export interface FeedAuthor {
  userId: Id;
  name: string;
  nickname: string | null;
  photo: string | null;
  roleLabel: string | null;
}

export interface FeedMedia {
  id: Id;
  /** Caminho assinado `/api/feed/media/<id>?e=…&s=…` (funciona direto em <img>). */
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
}

/** Só os campos que a moderação usa; o resto do `FeedPost` do contrato (reações, comentários...) é ignorado aqui. */
export interface FeedPost {
  id: Id;
  type?: "POST" | "ANNOUNCEMENT";
  /**
   * Contrato seção 9 (stories): `STORY` = foto + legenda que expira em 24 h. Opcional aqui para não quebrar contra um
   * backend sem o campo (ausente = `POST`).
   */
  kind?: "POST" | "STORY";
  /** Só stories: quando vencem (`null`/ausente nos posts). */
  expiresAt?: string | null;
  /** `null` = autor anonimizado (pedido de exclusão LGPD). */
  author: FeedAuthor | null;
  body: string | null;
  media: FeedMedia[];
  visibility: FeedVisibility;
  unitId: Id | null;
  classId: Id | null;
  pinned: boolean;
  status: FeedStatus;
  createdAt: string;
  edited?: boolean;
  commentsCount?: number;
  /** Quando `false` o moderador só vê o post (ex.: professor num post de todo o grupo). */
  canModerate?: boolean;
}

export interface FeedReport {
  reason: ReportReason | string;
  note: string | null;
  createdAt: string;
}

export type FeedCommentStatus = "PUBLISHED" | "HIDDEN" | "REMOVED";

/**
 * Comentário denunciado (formato REAL do backend, `item.comment` ao lado de `item.post`): `body` é `null` se o texto
 * foi apagado; `status` `HIDDEN` = ocultado automaticamente por 3 denúncias, ainda sem decisão do moderador.
 */
export interface FeedQueueComment {
  id: Id;
  parentId?: Id | null;
  body: string | null;
  author?: FeedAuthor | null;
  status?: FeedCommentStatus;
  createdAt?: string;
}

/**
 * Item da fila. Post denunciado: `{ post, reports, reportsCount }`. Comentário denunciado: o mesmo + `comment`
 * (o `post` é o post dono do comentário). `reports` nunca traz quem denunciou.
 */
export interface QueueItem {
  post: FeedPost;
  reports: FeedReport[];
  reportsCount: number;
  comment?: FeedQueueComment | null;
}

export interface QueuePage {
  items: QueueItem[];
  nextCursor: string | null;
}

export interface FeedSettings {
  enabled: boolean;
  postingMode: PostingMode;
  allowComments: boolean;
  blockedWords: string[];
}

export const QUEUE_KINDS: readonly QueueKind[] = ["PENDING", "REPORTED", "HIDDEN"];

export const QUEUE_LABEL: Record<QueueKind, string> = {
  PENDING: "Pendentes",
  REPORTED: "Denunciados",
  HIDDEN: "Ocultos",
};

export const QUEUE_EMPTY: Record<QueueKind, string> = {
  PENDING: "Nenhuma publicação aguardando aprovação.",
  REPORTED: "Nenhuma publicação denunciada.",
  HIDDEN: "Nenhuma publicação oculta.",
};

export const VISIBILITY_LABEL: Record<FeedVisibility, string> = {
  GROUP: "Todo o grupo",
  UNIT: "Uma unidade",
  CLASS: "Uma turma",
};

export const STATUS_LABEL: Record<FeedStatus, string> = {
  PUBLISHED: "Publicado",
  PENDING_APPROVAL: "Aguardando aprovação",
  HIDDEN: "Oculto",
  REMOVED: "Removido",
};

export const REASON_LABEL: Record<string, string> = {
  OFENSIVO: "Ofensivo",
  IMPROPRIO: "Impróprio",
  SPAM: "Spam",
  MENOR: "Menor de idade",
  OUTRO: "Outro",
};

export const POSTING_MODES: readonly { value: PostingMode; label: string; help: string }[] = [
  {
    value: "ALL",
    label: "Todos podem postar",
    help: "Quem é do grupo publica direto. Posts de menores de 18 anos e com palavras bloqueadas ainda esperam aprovação.",
  },
  {
    value: "STAFF_ONLY",
    label: "Só equipe",
    help: "Apenas mestre, professores e instrutores publicam. Os alunos só veem, reagem e comentam.",
  },
  {
    value: "MODERATED",
    label: "Alunos com aprovação",
    help: "Posts de alunos, responsáveis e monitores ficam aguardando você aprovar. A equipe publica direto. (Padrão)",
  },
];

export const BLOCKED_WORDS_MAX = 50;
export const BLOCKED_WORD_LENGTH_MAX = 40;
