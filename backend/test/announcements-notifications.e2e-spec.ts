import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { ALUNO_EMAIL as ALUNO, MESTRE_EMAIL as MESTRE, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * Comunicados (src/interface/http/announcements/announcements.service.ts) + Notificações
 * (src/interface/http/notifications/notifications.service.ts).
 *
 * O que torna Announcement mais que um CRUD: ao publicar (`create`), `notifyAudience`
 * (método privado) monta o público-alvo e cria uma `Notification` por usuário — sem
 * `unitId`, todo `OrganizationUser` ativo da organização (qualquer papel), o que inclui os 4
 * usuários do seed (mestre/professor/aluno/responsavel). Notification é sempre escopada por
 * `userId` (nunca por organização/RBAC): um usuário só vê e só marca como lida a própria.
 *
 * Reaproveita os 4 usuários do seed (prisma/seed.ts) em vez de criar fixtures próprias.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const RESPONSAVEL_EMAIL = 'responsavel@gingabrasil.com.br';

interface LoginResult {
  accessToken: string;
  user: { id: number; organizationId: number };
}

async function login(app: INestApplication, email: string): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as LoginResult;
}

describe('Comunicados e Notificações (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let mestreUserId: number;
  let organizationId: number;
  let professorToken: string;
  let professorUserId: number;
  let alunoToken: string;
  let alunoUserId: number;
  let responsavelToken: string;
  let responsavelUserId: number;

  let announcementId: number;
  let mestreNotificationId: number;
  let alunoNotificationId: number;
  let responsavelNotificationId: number;

  // Título único (com timestamp): usado tanto para filtrar as Notification geradas por esta
  // suíte (fan-out gera 1 por usuário do seed — precisamos conseguir limpar todas de novo,
  // sem apagar notificações de outras origens/suítes) quanto para nunca colidir com dados de
  // outra execução rodando contra o mesmo Postgres compartilhado.
  const ANNOUNCEMENT_TITLE = `[e2e-test] Comunicado de teste ${Date.now()}`;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    mestreUserId = mestreLogin.user.id;
    organizationId = mestreLogin.user.organizationId;

    const professorLogin = await login(app, PROFESSOR_EMAIL);
    professorToken = professorLogin.accessToken;
    professorUserId = professorLogin.user.id;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;
    alunoUserId = alunoLogin.user.id;

    const responsavelLogin = await login(app, RESPONSAVEL_EMAIL);
    responsavelToken = responsavelLogin.accessToken;
    responsavelUserId = responsavelLogin.user.id;
  });

  after(async () => {
    // Limpa tudo que esta suíte gerou: o comunicado + as 4 Notification do fan-out (uma por
    // usuário do seed), sempre filtrando pelo título único — nunca mexe em notificações de
    // outra origem desses mesmos usuários (dados reais do seed/uso manual).
    await prisma.notification.deleteMany({ where: { title: ANNOUNCEMENT_TITLE } });
    if (announcementId) {
      await prisma.announcement.deleteMany({ where: { id: announcementId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /announcements (mestre) sem unitId cria um comunicado de escopo organização inteira → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ title: ANNOUNCEMENT_TITLE, body: 'Corpo do comunicado de teste e2e.' })
      .expect(201);

    announcementId = res.body.id;
    assert.equal(typeof announcementId, 'number');
    assert.equal(res.body.unitId, null);
  });

  it('fan-out: cada um dos 4 usuários do seed recebeu uma Notification com o título do comunicado (confirmado via Prisma)', async () => {
    const notifications = await prisma.notification.findMany({ where: { title: ANNOUNCEMENT_TITLE } });

    assert.ok(notifications.length >= 4, `esperava >= 4 notificações, recebeu ${notifications.length}`);

    const recipientIds = new Set(notifications.map((n) => n.userId));
    assert.ok(recipientIds.has(mestreUserId), 'mestre deveria ter recebido a notificação');
    assert.ok(recipientIds.has(professorUserId), 'professor deveria ter recebido a notificação');
    assert.ok(recipientIds.has(alunoUserId), 'aluno deveria ter recebido a notificação');
    assert.ok(recipientIds.has(responsavelUserId), 'responsável deveria ter recebido a notificação');

    mestreNotificationId = notifications.find((n) => n.userId === mestreUserId)!.id;
    alunoNotificationId = notifications.find((n) => n.userId === alunoUserId)!.id;
    responsavelNotificationId = notifications.find((n) => n.userId === responsavelUserId)!.id;

    // Também confere via API (GET /notifications), não só direto no Postgres.
    const apiRes = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    assert.ok(apiRes.body.some((n: { title: string }) => n.title === ANNOUNCEMENT_TITLE));
  });

  it('PATCH /notifications/:id/read logado como o dono → readAt deixa de ser nulo (confirmado via Prisma)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/notifications/${mestreNotificationId}/read`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.notification.findUnique({ where: { id: mestreNotificationId } });
    assert.ok(persisted?.readAt != null);
  });

  it('PATCH /notifications/:id/read logado como quem NÃO é o dono (aluno tentando marcar a notificação do mestre) → 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/notifications/${mestreNotificationId}/read`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(404);

    assert.equal(res.body.message, 'Notificação não encontrada.');
  });

  it('GET /notifications/unread-count reflete corretamente antes/depois de marcar como lida (delta, não valor absoluto — DB compartilhado)', async () => {
    // Usa delta em vez de valor absoluto: o Postgres é compartilhado com outras suítes/sessões
    // nesta máquina, então o total de não-lidas do aluno pode já ter outras notificações. O que
    // este teste prova é que marcar a notificação do aluno como lida diminui a contagem dele em
    // exatamente 1 — não o valor absoluto.
    const before = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    assert.equal(typeof before.body.count, 'number');
    assert.ok(before.body.count >= 1, 'aluno deveria ter ao menos a notificação do fan-out como não lida');

    await request(app.getHttpServer())
      .patch(`/api/notifications/${alunoNotificationId}/read`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.equal(after.body.count, before.body.count - 1);
  });

  it('PATCH /notifications/read-all marca todas as não lidas do usuário logado, sem afetar as de outros usuários', async () => {
    // Confirma o estado de partida: a notificação do responsável (gerada pelo fan-out) ainda
    // não foi tocada por nenhum teste anterior, então continua não lida.
    const responsavelBefore = await prisma.notification.findUnique({ where: { id: responsavelNotificationId } });
    assert.equal(responsavelBefore?.readAt, null);

    await request(app.getHttpServer())
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(200);

    const remainingUnreadForProfessor = await prisma.notification.count({
      where: { userId: professorUserId, readAt: null },
    });
    assert.equal(remainingUnreadForProfessor, 0);

    // Notificação do responsável (outro usuário) não foi tocada pelo read-all do professor.
    const responsavelAfter = await prisma.notification.findUnique({ where: { id: responsavelNotificationId } });
    assert.equal(responsavelAfter?.readAt, null);
  });

  it('DELETE /announcements/:id (mestre) é soft-delete: isActive vira false, o registro NUNCA é apagado (confirmado via Prisma)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.announcement.findUnique({ where: { id: announcementId } });
    assert.ok(persisted !== null, 'o comunicado deveria continuar existindo no banco (soft-delete)');
    assert.equal(persisted?.isActive, false);
  });
});

/** Paginação + filtros, limpar campos no PATCH e RBAC de GET /announcements. */
describe('Comunicados — lista paginada e limpar campos (e2e)', () => {
  const TAG = `B2ANN${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let unitId: number;
  const get = (path: string, token = mestre.token) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: number, body: object) =>
    request(app.getHttpServer()).patch(`/api/announcements/${id}`).set('Authorization', `Bearer ${mestre.token}`).send(body);

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    orgB = await createSecondOrg(app, prisma, 'ann');
    unitId = (await prisma.unit.findFirstOrThrow({ where: { organizationId: mestre.organizationId } })).id;

    // 55 comunicados: inativos os múltiplos de 5 (11), com unidade os 10 primeiros, corpo marcado nos pares.
    await prisma.announcement.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: mestre.organizationId,
        createdByUserId: mestre.userId,
        title: `${TAG} aviso ${i}`,
        body: i % 2 === 0 ? `Corpo ${TAG}Y` : 'Corpo comum',
        isActive: i % 5 !== 0,
        unitId: i < 10 ? unitId : null,
        publishedAt: new Date(),
      })),
    });
    await prisma.announcement.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: orgB.organizationId,
        createdByUserId: orgB.userId,
        title: `${TAG} orgB ${i}`,
        body: 'b',
      })),
    });
  });

  after(async () => {
    await prisma.announcement.deleteMany({ where: { title: { startsWith: TAG } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem limit: array de 50 e X-Total-Count real; limit/offset fatiam na mesma ordem (id desc)', async () => {
    const res = await get('/announcements').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], String(await prisma.announcement.count({ where: { organizationId: mestre.organizationId } })));
    const all = await prisma.announcement.findMany({ where: { organizationId: mestre.organizationId, title: { startsWith: TAG } }, orderBy: { id: 'desc' } });
    const page = await get(`/announcements?q=${TAG}&limit=10&offset=50`).expect(200);
    assert.equal(page.headers['x-total-count'], '55');
    assert.deepEqual(page.body.map((a: { id: number }) => a.id), all.slice(50).map((a) => a.id));
  });

  it('limit=201, limit=0, offset=-1, isActive inválido, unitId inválido e parâmetro desconhecido => 400', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'isActive=talvez', 'unitId=x', 'foo=1']) await get(`/announcements?${qs}`).expect(400);
  });

  it('filtros: isActive (true/false), unitId e q (título e corpo)', async () => {
    assert.equal((await get(`/announcements?q=${TAG}&isActive=false`).expect(200)).headers['x-total-count'], '11');
    assert.equal((await get(`/announcements?q=${TAG}&isActive=true`).expect(200)).headers['x-total-count'], '44');
    assert.equal((await get(`/announcements?q=${TAG}&unitId=${unitId}`).expect(200)).headers['x-total-count'], '10');
    assert.equal((await get(`/announcements?q=${TAG}&unitId=${unitId}&isActive=false`).expect(200)).headers['x-total-count'], '2'); // 0 e 5
    assert.equal((await get(`/announcements?q=${(TAG + 'y').toLowerCase()}`).expect(200)).headers['x-total-count'], '28');
    assert.equal((await get(`/announcements?q=${TAG}%20aviso%2054`).expect(200)).headers['x-total-count'], '1');
  });

  it('total NÃO inclui outra organização', async () => {
    assert.equal((await get(`/announcements?q=${TAG}`).expect(200)).headers['x-total-count'], '55');
    assert.equal((await get(`/announcements?q=${TAG}`, orgB.token).expect(200)).headers['x-total-count'], '3');
  });

  it('PATCH unitId=null limpa a unidade (volta ao grupo inteiro) — 2ª via: Prisma', async () => {
    const a = await prisma.announcement.create({
      data: { organizationId: mestre.organizationId, createdByUserId: mestre.userId, title: `${TAG} limpar`, body: 'corpo', unitId },
    });
    await patch(a.id, { unitId: null }).expect(200);
    assert.equal((await prisma.announcement.findUniqueOrThrow({ where: { id: a.id } })).unitId, null);
  });

  it('null em campo OBRIGATÓRIO => 400 (title, body, isActive, publishedAt) e nada muda', async () => {
    const a = await prisma.announcement.create({
      data: { organizationId: mestre.organizationId, createdByUserId: mestre.userId, title: `${TAG} obrig`, body: 'corpo', publishedAt: new Date() },
    });
    for (const body of [{ title: null }, { body: null }, { isActive: null }, { publishedAt: null }]) await patch(a.id, body).expect(400);
    const db = await prisma.announcement.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(db.title, `${TAG} obrig`);
    assert.ok(db.publishedAt && db.isActive);
  });

  it('RBAC inalterado: sem token 401; ALUNO lista (200) mas não edita (403)', async () => {
    await request(app.getHttpServer()).get('/api/announcements').expect(401);
    await get('/announcements', aluno.token).expect(200);
    const a = await prisma.announcement.findFirstOrThrow({ where: { title: { startsWith: TAG }, organizationId: mestre.organizationId } });
    await request(app.getHttpServer()).patch(`/api/announcements/${a.id}`).set('Authorization', `Bearer ${aluno.token}`).send({ unitId: null }).expect(403);
  });
});

/**
 * Notificações com >50: GET /notifications cortava em 50 sem aviso (e o app contava "não lidas"
 * sobre essa lista). Agora limit/offset + X-Total-Count; o contador de não lidas vem de
 * /notifications/unread-count (agregado no banco).
 */
describe('Notificações — paginação com total real (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const base = Date.now() - 60 * 60 * 1000;

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'notme');
    // 58 do aluno (createdAt distintos, mais novas primeiro = índice menor; 3 já lidas) e 4 do
    // responsável (não podem vazar).
    await prisma.notification.createMany({
      data: [
        ...Array.from({ length: 58 }, (_, i) => ({
          userId: fx.self.userId,
          title: `notme self ${i}`,
          body: 'corpo',
          createdAt: new Date(base - i * 1000),
          readAt: i % 20 === 5 ? new Date() : null, // i = 5, 25, 45
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          userId: fx.guardian.userId,
          title: `notme guardian ${i}`,
          body: 'corpo',
          createdAt: new Date(base - i * 1000),
        })),
      ],
    });
  });

  after(async () => {
    await fx.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('58 notificações: sem limit vêm 50 (array, mais recentes primeiro) e X-Total-Count = 58; offset completa sem repetir', async () => {
    const first = await get('/notifications', fx.self.token).expect(200);
    assert.ok(Array.isArray(first.body));
    assert.equal(first.body.length, 50);
    assert.equal(first.headers['x-total-count'], '58');
    assert.equal(first.body[0].title, 'notme self 0');

    const rest = await get('/notifications?limit=50&offset=50', fx.self.token).expect(200);
    assert.equal(rest.body.length, 8);
    assert.equal(rest.headers['x-total-count'], '58');
    const titles = [...first.body, ...rest.body].map((n: { title: string }) => n.title);
    assert.deepEqual(titles, Array.from({ length: 58 }, (_, i) => `notme self ${i}`));

    const big = await get('/notifications?limit=200', fx.self.token).expect(200);
    assert.equal(big.body.length, 58);
  });

  it('o contador de não lidas vem do banco (58 - 3 lidas = 55), independente do tamanho da página', async () => {
    const res = await get('/notifications/unread-count', fx.self.token).expect(200);
    assert.deepEqual(res.body, { count: 55 });
    // contar sobre a página de 50 daria outro número (lidas i=5,25,45 estão nela => 47)
    const page = await get('/notifications', fx.self.token).expect(200);
    const naive = page.body.filter((n: { readAt: string | null }) => n.readAt === null).length;
    assert.equal(naive, 47);
    assert.notEqual(naive, res.body.count);
  });

  it('isolamento: cada um só vê as suas; sem notificações => [] com total 0', async () => {
    const guardian = await get('/notifications', fx.guardian.token).expect(200);
    assert.equal(guardian.headers['x-total-count'], '4');
    assert.ok(guardian.body.every((n: { userId: number }) => n.userId === fx.guardian.userId));
    const self = await get('/notifications?limit=200', fx.self.token).expect(200);
    assert.ok(self.body.every((n: { userId: number }) => n.userId === fx.self.userId));
    const orphan = await get('/notifications', fx.orphan.token).expect(200);
    assert.deepEqual(orphan.body, []);
    assert.equal(orphan.headers['x-total-count'], '0');
  });

  it('parâmetros inválidos => 400 (limit=201/0/abc, offset=-1, desconhecido); sem token 401', async () => {
    for (const qs of ['limit=201', 'limit=0', 'limit=abc', 'offset=-1', 'foo=1', 'q=x']) {
      await get(`/notifications?${qs}`, fx.self.token).expect(400);
    }
    await get('/notifications?limit=200&offset=0', fx.self.token).expect(200);
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });
});
