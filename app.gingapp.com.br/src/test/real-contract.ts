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
 *  - FeedPost: PATCH no post pendente dá 409 INVALID_STATE. Na captura de 2026-10-21 o backend mandava `canEdit:true` também
 *    no pendente; na conferência de 2026-10-28 (stories) ele manda `canEdit:false` (só POST publicado edita; story nunca);
 *  - denúncia repetida => 200 `{ ok:true }` (sem 409); denunciar o próprio => 400 VALIDATION.
 *
 * Stories (REAL_STORIES, REAL_STORY_POST): capturados em 2026-10-28 de `node dist/main.js` (porta 3931, banco dev, grupo demo,
 * `FEED_STORIES_PER_DAY=3`), contra o app REAL (hooks de `lib/stories.ts`). O que ficou provado:
 *  - GET /feed/stories => `{ groups:[{ author, isMine, hasUnseen, items:[{ id, media, caption, createdAt, expiresAt, seen, status }] }] }`,
 *    meu grupo primeiro (com `seen:true` e `hasUnseen:false` sempre), depois autores com story não visto (mais recente primeiro);
 *  - POST /feed/stories => 201 `FeedPost` com `kind:"STORY"`, `type:"POST"`, `expiresAt` = criação + 24 h, `canEdit:false`;
 *    aluno em MODERATED, menor de 18 e palavra bloqueada => `PENDING_APPROVAL` (foto com URL de revisão `&r=1`); professor/mestre => `PUBLISHED`;
 *  - POST /feed/stories/:id/view => 204 idempotente (e 204 para o próprio autor); fora de alcance/inexistente/vencido => 404 NOT_FOUND;
 *  - reagir/comentar/editar/fixar story => 409 INVALID_STATE; 4o story do dia => 429 STORY_LIMIT; feed desligado => 403 FEED_DISABLED.
 */
import type { BirthdayWeekItem } from "@/lib/birthdays";
import type { PinnedCommunication } from "@/lib/communications";
import type { FeedComment, FeedMediaUpload, FeedPost, FeedSettings, ReactionSummary } from "@/lib/feed";
import type { NotificationDto } from "@/lib/queries";
import type { StoriesResponse } from "@/lib/stories";

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
  // `kind` e `expiresAt` entraram no contrato de 2026-10-27 (seção 9, stories): vêm do contrato, não da captura de 2026-10-21.
  kind: "POST",
  expiresAt: null,
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
  // `recentComments` entrou no contrato de 2026-10-28 (cartão estilo Instagram): do CONTRATO, não de uma captura do backend
  // (que estava sendo ajustado em paralelo). Post sem comentário = `[]`; o campo pode faltar num backend antigo (app trata como `[]`).
  recentComments: [],
  // Conferido em 2026-10-28: o pendente do autor volta com `canEdit:false` (em 2026-10-21 vinha `true`; o PATCH sempre foi 409).
  canEdit: false,
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
  commentsCount: 3,
  // Forma do contrato: até 2 comentários de 1º nível, em ordem cronológica (o último é o mais novo); `parentId` sempre null.
  recentComments: [
    { id: 410, parentId: null, author: { userId: 2426, name: "Rafael Oliveira", nickname: null, photo: null, roleLabel: null }, body: "Axé, Mestre!", createdAt: "2026-10-21T05:10:00.000Z" },
    { id: 411, parentId: null, author: null, body: "Salve!", createdAt: "2026-10-21T05:12:00.000Z" },
  ],
  canEdit: true,
  canModerate: true,
};

/**
 * POST /feed/stories (aluno adulto em MODERATED): 201 com o `FeedPost` do story, capturado do backend REAL em 2026-10-28.
 * `body` = legenda já normalizada numa linha só; `expiresAt` = criação + 24 h; a foto traz a URL de revisão (`&r=1`).
 */
export const REAL_STORY_POST: FeedPost = {
  id: 854,
  type: "POST",
  kind: "STORY",
  expiresAt: "2026-10-29T03:18:21.669Z",
  author: { userId: 2426, name: "Rafael Oliveira", nickname: null, photo: null, roleLabel: null },
  body: "Treino de hoje",
  media: [
    {
      id: 368,
      url: "/api/feed/media/368?e=1793159400&s=wu0gTWKA1xFAR3cpfiLFYDQpNFOvGIg4pFFhVJ1myJM&r=1",
      thumbUrl: "/api/feed/media/368/thumb?e=1793159400&s=UkmANoTeFDlRNL2Cbqe4vN-6vHV9ZejOEgME3eiy8NI&r=1",
      width: 320,
      height: 200,
    },
  ],
  visibility: "GROUP",
  unitId: null,
  classId: null,
  pinned: false,
  status: "PENDING_APPROVAL",
  createdAt: "2026-10-28T03:18:21.677Z",
  edited: false,
  reactions: NO_REACTIONS,
  commentsCount: 0,
  recentComments: [],
  canEdit: false,
  canDelete: true,
  canModerate: false,
};

/**
 * GET /feed/stories como o aluno Rafael (autor do story pendente acima) recebe, capturado do backend REAL em 2026-10-28:
 * meu grupo primeiro (`seen:true`, `hasUnseen:false`, mesmo pendente), depois quem tem story não visto (o professor publicou
 * depois do Mestre, então vem antes; o Mestre tem 2 itens, do mais antigo para o mais novo). A foto de status
 * `PUBLISHED` NÃO tem `&r=1`; a pendente do autor tem.
 */
export const REAL_STORIES: StoriesResponse = {
  groups: [
    {
      author: REAL_STORY_POST.author,
      isMine: true,
      hasUnseen: false,
      items: [
        {
          id: 854,
          media: REAL_STORY_POST.media[0]!,
          caption: "Treino de hoje",
          createdAt: "2026-10-28T03:18:21.677Z",
          expiresAt: "2026-10-29T03:18:21.669Z",
          seen: true,
          status: "PENDING_APPROVAL",
        },
      ],
    },
    {
      author: { userId: 2423, name: "Professor Thiago Barbosa", nickname: null, photo: null, roleLabel: "Professor" },
      isMine: false,
      hasUnseen: true,
      items: [
        {
          id: 853,
          media: {
            id: 367,
            url: "/api/feed/media/367?e=1793181600&s=TM4M4kwbHlB_l6KakK4BWlhA_ftZAJRUUf-YG1r-DQw",
            thumbUrl: "/api/feed/media/367/thumb?e=1793181600&s=SuEZ8F5LbI_oyjjTgXhRXpgNkX607Med6XotXRPOdGI",
            width: 320,
            height: 200,
          },
          caption: "grupo todo",
          createdAt: "2026-10-28T03:18:21.110Z",
          expiresAt: "2026-10-29T03:18:21.103Z",
          seen: false,
          status: "PUBLISHED",
        },
      ],
    },
    {
      author: { userId: 2422, name: "Mestre Ricardo Menezes", nickname: null, photo: null, roleLabel: "Mestre" },
      isMine: false,
      hasUnseen: true,
      items: [
        {
          id: 851,
          media: {
            id: 365,
            url: "/api/feed/media/365?e=1793181600&s=caN65rHgmSqxfS3huImlRIQMS3ehCr45dhGc7mQvxQQ",
            thumbUrl: "/api/feed/media/365/thumb?e=1793181600&s=XlPJK7D9csRVDvNDQA6INmqhBVjdkxmLV4xdQq0iag0",
            width: 320,
            height: 200,
          },
          caption: "so unidade 630",
          createdAt: "2026-10-28T03:18:20.863Z",
          expiresAt: "2026-10-29T03:18:20.849Z",
          seen: false,
          status: "PUBLISHED",
        },
        {
          id: 852,
          media: {
            id: 366,
            url: "/api/feed/media/366?e=1793181600&s=Fw2SthF6bA9knrgeexIk2_iUTKSLwLB2EMjYplcA6Lw",
            thumbUrl: "/api/feed/media/366/thumb?e=1793181600&s=UHnjSGRlhLJhpVVOdcZ1VF1Jo3OnhK90gMfcHS2ySRc",
            width: 320,
            height: 200,
          },
          caption: "so turma 1088",
          createdAt: "2026-10-28T03:18:20.950Z",
          expiresAt: "2026-10-29T03:18:20.937Z",
          seen: false,
          status: "PUBLISHED",
        },
      ],
    },
  ],
};

export const REAL_FEED_SETTINGS: FeedSettings = { enabled: true, postingMode: "MODERATED", canPost: true, allowComments: true, requiresApproval: true };

/** Comentários chegam em ordem CRONOLÓGICA (mais antigo primeiro); resposta de resposta é recusada (400). */
export const REAL_COMMENTS: FeedComment[] = [
  { id: 61, parentId: null, author: REAL_POST_PENDING.author, body: "Primeiro", createdAt: "2026-10-21T04:49:02.000Z", canDelete: true },
  { id: 62, parentId: 61, author: REAL_POST_PUBLISHED.author, body: "Resposta", createdAt: "2026-10-21T04:49:03.000Z", canDelete: false },
  { id: 63, parentId: null, author: REAL_POST_PENDING.author, body: "Terceiro", createdAt: "2026-10-21T04:49:04.000Z", canDelete: true },
];
