import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

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
