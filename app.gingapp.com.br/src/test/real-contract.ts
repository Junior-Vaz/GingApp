/**
 * Amostras do contrato REAL do backend (Aniversariantes, Comunicar e Feed), capturadas em 2026-10-21 de `node dist/main.js`
 * contra o banco de desenvolvimento com o grupo demo (dados fictícios), TIPADAS com as interfaces do app: se um campo mudar
 * de um lado só, o `tsc` aponta a divergência aqui.
 *
 * O que a conferência provou (e estas amostras fixam):
 *  - POST /birthdays/:personId/congratulate => 200 `{ sent: true }`; repetido => 409 ALREADY_CONGRATULATED;
 *    a si mesmo => 403 CANNOT_CONGRATULATE_SELF; menor/opt-out/inexistente => 403 BIRTHDAY_NOT_VISIBLE;
 *  - POST /communications/:id/ack => 201 `{ ok, response }`; erros 403 NOT_RECIPIENT, 400 ACK_NOT_ALLOWED;
 *  - GET /notifications: `data` = `{ communicationId, requiresAck }` (COMMUNICATION) ou `{ postId, actorUserId? }` (FEED_*);
 *  - FeedPost: `canEdit:true` também no post pendente, mas PATCH nele dá 409 INVALID_STATE;
 *  - denúncia repetida => 200 `{ ok:true }` (sem 409); denunciar o próprio => 400 VALIDATION.
 */
import type { BirthdayWeekItem } from "@/lib/birthdays";
import type { PinnedCommunication } from "@/lib/communications";
import type { FeedComment, FeedMediaUpload, FeedPost, FeedSettings, ReactionSummary } from "@/lib/feed";
import type { NotificationDto } from "@/lib/queries";

export const REAL_WEEK_ITEM: BirthdayWeekItem = {
  personId: 20,
  name: "Juliana Ferreira",
  nickname: null,
  photo: null,
  day: 21,
  month: 10,
  isToday: true,
  canCongratulate: true,
  congratulatedByMe: false,
};

/** O próprio usuário aparece na semana, mas sem poder se parabenizar. */
export const REAL_WEEK_SELF: BirthdayWeekItem = { ...REAL_WEEK_ITEM, personId: 19, name: "Rafael Oliveira", day: 23, isToday: false, canCongratulate: false };

export const REAL_PINNED: PinnedCommunication = {
  id: 7953,
  title: "Aviso da turma",
  body: "Treino especial.",
  imageUrl: null,
  requiresAck: "GOING",
  myAck: null,
  pinnedUntil: null,
  createdAt: "2026-10-21T04:49:01.073Z",
};

/** Notificação de comunicado como `GET /notifications` devolve (`readAt` já preenchido depois do ack). */
export const REAL_COMMUNICATION_NOTICE: NotificationDto & { organizationId: number; userId: number; announcementId: number | null } = {
  id: 91787,
  organizationId: 883,
  userId: 2426,
  title: "Aviso da turma",
  body: "Treino especial.",
  type: "COMMUNICATION",
  readAt: null,
  createdAt: "2026-10-21T04:49:01.076Z",
  data: { requiresAck: "GOING", communicationId: 7953 },
  announcementId: 7953,
};

export const REAL_FEED_NOTICE_ACTIVITY: NotificationDto & { organizationId: number; userId: number; announcementId: number | null } = {
  id: 91800,
  organizationId: 883,
  userId: 2426,
  title: "Atividade no seu post",
  body: "Mestre Ricardo Menezes e mais 1 pessoa interagiu com o seu post.",
  type: "FEED_ACTIVITY",
  readAt: null,
  createdAt: "2026-10-21T04:50:00.000Z",
  data: { postId: 319, actorUserId: 2422 },
  announcementId: null,
};

const NO_REACTIONS: ReactionSummary = { counts: { AXE: 0, SALVE: 0, GINGA: 0, PARABENS: 0, CORACAO: 0 }, total: 0, mine: null };

export const REAL_UPLOAD: FeedMediaUpload = {
  mediaId: 81,
  url: "/api/feed/media/81?e=1792560000&s=98XAxhi4m-7hf3MOz1h_uLKkwWYJye0ywstG03PxleI&r=1",
  thumbUrl: "/api/feed/media/81/thumb?e=1792560000&s=8lxZacPyvO49prW_QcSQC2GhKLurGW-gSZFk1jDeUHU&r=1",
  width: 320,
  height: 200,
};

/** Post de aluno em modo MODERATED: 201 com `PENDING_APPROVAL` e foto com URL de revisão (`&r=1`, 30 min). */
export const REAL_POST_PENDING: FeedPost = {
  id: 343,
  type: "POST",
  author: { userId: 2426, name: "Rafael Oliveira", nickname: null, photo: null, roleLabel: null },
  body: "Treino de hoje",
  media: [{ id: 81, url: REAL_UPLOAD.url, thumbUrl: REAL_UPLOAD.thumbUrl, width: 320, height: 200 }],
  visibility: "GROUP",
  unitId: null,
  classId: null,
  pinned: false,
  status: "PENDING_APPROVAL",
  createdAt: "2026-10-21T04:49:01.909Z",
  edited: false,
  reactions: NO_REACTIONS,
  commentsCount: 0,
  canEdit: true,
  canDelete: true,
  canModerate: false,
};

export const REAL_POST_PUBLISHED: FeedPost = {
  ...REAL_POST_PENDING,
  id: 344,
  author: { userId: 2422, name: "Mestre Ricardo Menezes", nickname: null, photo: null, roleLabel: "Mestre" },
  body: "Aviso do Mestre",
  media: [],
  status: "PUBLISHED",
  canModerate: true,
};

export const REAL_FEED_SETTINGS: FeedSettings = { enabled: true, postingMode: "MODERATED", canPost: true, allowComments: true, requiresApproval: true };

/** Comentários chegam em ordem CRONOLÓGICA (mais antigo primeiro); resposta de resposta é recusada (400). */
export const REAL_COMMENTS: FeedComment[] = [
  { id: 61, parentId: null, author: REAL_POST_PENDING.author, body: "Primeiro", createdAt: "2026-10-21T04:49:02.000Z", canDelete: true },
  { id: 62, parentId: 61, author: REAL_POST_PUBLISHED.author, body: "Resposta", createdAt: "2026-10-21T04:49:03.000Z", canDelete: false },
  { id: 63, parentId: null, author: REAL_POST_PENDING.author, body: "Terceiro", createdAt: "2026-10-21T04:49:04.000Z", canDelete: true },
];
