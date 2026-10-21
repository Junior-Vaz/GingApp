/**
 * Amostras do contrato REAL do backend (Aniversariantes, Comunicar e Feed), capturadas em 2026-10-21 de `node dist/main.js`
 * contra o banco de desenvolvimento com o grupo demo (dados fictícios). Estão TIPADAS com as interfaces do painel: se o
 * backend mudar um campo e a interface for atualizada (ou o inverso), o `tsc` aponta a divergência aqui, e os testes que
 * usam estas amostras como resposta de API deixam de mentir sobre o formato.
 *
 * Divergências que a conferência encontrou e que estas amostras fixam:
 *  - POST /communications/:id/resend-unread => 201 `{ sent }` (não `resent`/`recipients`);
 *  - GET /communications: itens com `pinnedUntil` e `lastResendAt`; `createdByName` pode ser `null`;
 *  - GET /communications/:id: `scope` sempre com as 6 chaves (`null` quando não se aplicam);
 *  - fila de moderação: `comment` ao lado de `post` (`{id,parentId,author,body,status,createdAt}`).
 */
import type { BirthdayItem, BirthdayList, BirthdaySettings, BirthdaySummary, GreetResult } from "@/modules/aniversariantes/types";
import type {
  CommunicationDetail,
  CommunicationItem,
  CreateCommunicationResult,
  PreviewResult,
  ResendResult,
} from "@/modules/comunicar/types";
import type { FeedPost, FeedSettings, QueueItem, QueuePage } from "@/modules/feed/types";

export const REAL_BIRTHDAY: BirthdayItem = {
  personId: 19,
  studentId: 1475,
  userId: 2426,
  name: "Rafael Oliveira",
  nickname: null,
  photo: null,
  day: 23,
  month: 10,
  age: 29,
  turnsAge: 29,
  isMinor: false,
  kind: "STUDENT",
  unitId: 630,
  unitName: "Matriz — Goiânia",
  classNames: ["Avançados e Graduados — Quarta 20h", "Adulto Iniciante — Segunda 19h"],
  phone: "(62) 99999-0229",
  greetedThisYear: false,
};

export const REAL_BIRTHDAY_MINOR: BirthdayItem = {
  ...REAL_BIRTHDAY,
  personId: 27,
  studentId: 1483,
  userId: 2428,
  name: "Pedro Henrique Lacerda",
  day: 22,
  age: 16,
  turnsAge: 16,
  isMinor: true,
  kind: "STAFF",
  unitId: 631,
  unitName: "Filial — Anápolis",
  classNames: ["Juvenil (13 a 17 anos) — Quinta 18h"],
  phone: "(62) 99999-0237",
};

export const REAL_BIRTHDAY_LIST: BirthdayList = { items: [REAL_BIRTHDAY_MINOR, REAL_BIRTHDAY], month: 10, total: 2 };

export const REAL_BIRTHDAY_SUMMARY: BirthdaySummary = {
  today: [{ ...REAL_BIRTHDAY, personId: 20, studentId: 1476, userId: 2427, name: "Juliana Ferreira", day: 21, age: 34, turnsAge: 34, kind: "STAFF", phone: "(62) 99999-0230" }],
  next7Days: [REAL_BIRTHDAY_MINOR, REAL_BIRTHDAY],
  monthTotal: 5,
  todayTotal: 1,
};

/** POST /birthdays/:personId/greet => 200 (nunca 201/409). */
export const REAL_GREET: GreetResult = {
  sent: true,
  alreadyGreeted: false,
  whatsappUrl: "https://wa.me/5562999990229?text=Parab%C3%A9ns%2C%20Rafael!",
};
export const REAL_GREET_AGAIN: GreetResult = { sent: false, alreadyGreeted: true, whatsappUrl: "https://wa.me/5562999990229?text=Parab%C3%A9ns%2C%20Rafael!" };

/** GET/PUT /birthdays/settings: mensagem vazia volta como a mensagem padrão do grupo. */
export const REAL_BIRTHDAY_SETTINGS: BirthdaySettings = {
  dailyDigest: true,
  autoGreeting: false,
  autoGreetingMessage: "Parabéns, {nome}! 🎉 A família {grupo} deseja um ótimo dia.",
  autoGreetingHour: 8,
};

export const REAL_PREVIEW: PreviewResult = { count: 3, sample: [{ name: "Juliana Ferreira" }, { name: "Mestre Ricardo Menezes" }, { name: "Rafael Oliveira" }] };

/** POST /communications => 201. */
export const REAL_CREATED: CreateCommunicationResult = { id: 7955, status: "SENT", recipients: 54 };

export const REAL_COMM_ITEM: CommunicationItem = {
  id: 7957,
  title: "Aviso da turma",
  status: "SENT",
  scopeType: "CLASS",
  scheduledAt: null,
  sentAt: "2026-10-21T04:50:24.404Z",
  recipientsCount: 3,
  readCount: 0,
  ackCount: 0,
  requiresAck: "GOING",
  pinToFeed: true,
  pinnedUntil: null,
  lastResendAt: null,
  createdAt: "2026-10-21T04:50:24.420Z",
  createdByName: "Mestre Ricardo Menezes",
};

export const REAL_COMM_DETAIL: CommunicationDetail = {
  ...REAL_COMM_ITEM,
  body: "Aviso da turma.",
  imageUrl: null,
  scope: { type: "CLASS", unitId: null, unitName: null, classId: 1088, className: "Avançados e Graduados — Quarta 20h", role: null },
  acks: { READ: 0, GOING: 0, NOT_GOING: 0 },
  pending: 3,
};

/** POST /communications/:id/resend-unread => 201 `{ sent }` (`sent: 0` = ninguém sem ler; o direito de 24 h não é gasto). */
export const REAL_RESEND: ResendResult = { sent: 54 };

export const REAL_FEED_POST: FeedPost = {
  id: 320,
  type: "POST",
  author: { userId: 2422, name: "Mestre Ricardo Menezes", nickname: null, photo: null, roleLabel: "Mestre" },
  body: "Aviso do Mestre para todo o grupo.",
  media: [],
  visibility: "GROUP",
  unitId: null,
  classId: null,
  pinned: false,
  status: "PENDING_APPROVAL",
  createdAt: "2026-10-21T04:45:07.165Z",
  edited: false,
  commentsCount: 0,
  canModerate: true,
};

/** Item da fila para um POST (sem `comment`). `reports` nunca traz o denunciante. */
export const REAL_QUEUE_POST: QueueItem = {
  post: REAL_FEED_POST,
  reports: [
    { reason: "IMPROPRIO", note: null, createdAt: "2026-10-21T04:45:08.814Z" },
    { reason: "MENOR", note: "tem criança", createdAt: "2026-10-21T04:45:08.861Z" },
  ],
  reportsCount: 2,
};

/** Item da fila para um COMENTÁRIO denunciado: `comment` ao lado de `post`. */
export const REAL_QUEUE_COMMENT: QueueItem = {
  post: { ...REAL_FEED_POST, status: "PUBLISHED" },
  comment: {
    id: 52,
    parentId: null,
    author: { userId: 2426, name: "Rafael Oliveira", nickname: null, photo: null, roleLabel: null },
    body: "Comentário polêmico",
    status: "PUBLISHED",
    createdAt: "2026-10-21T04:45:08.736Z",
  },
  reports: [{ reason: "OFENSIVO", note: "nao gostei", createdAt: "2026-10-21T04:45:08.772Z" }],
  reportsCount: 1,
};

export const REAL_QUEUE_PAGE: QueuePage = { items: [REAL_QUEUE_POST, REAL_QUEUE_COMMENT], nextCursor: null };

/** GET /feed/settings/admin e resposta do PUT /feed/settings (os dois devolvem a visão de admin). */
export const REAL_FEED_SETTINGS_ADMIN: FeedSettings & { canPost: boolean; requiresApproval: boolean } = {
  enabled: true,
  postingMode: "MODERATED",
  canPost: true,
  allowComments: true,
  requiresApproval: false,
  blockedWords: ["ctpalavra"],
};
