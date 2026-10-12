import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { NotificationsService } from '../src/interface/http/notifications/notifications.service';
import { PushService } from '../src/shared/push/push.service';
import { SecondOrg, createSecondOrg } from './utils/list-helpers';
import { MemoryPushSender, createTestApp } from './utils/test-app';

/**
 * Web Push (I13). O remetente é um STUB em memória (MemoryPushSender): nenhum push real sai da suíte.
 * Fixtures próprias (2 grupos "E2E push ..." com 1 MESTRE cada): não toca no seed ginga-brasil nem no demo;
 * tudo é removido no after().
 */
describe('Web Push (e2e)', () => {
  let appOff: INestApplication; // sem VAPID e sem remetente: recurso desligado
  let app: INestApplication; // com remetente em memória
  const sender = new MemoryPushSender();
  const prisma = new PrismaClient();
  let a: SecondOrg;
  let b: SecondOrg;
  const stamp = Date.now();
  const endpointA = `https://fcm.googleapis.com/fcm/send/e2e-push-a-${stamp}`;
  const endpointB = `https://fcm.googleapis.com/fcm/send/e2e-push-b-${stamp}`;
  const keys = { p256dh: 'BE2E-p256dh-key-0123456789abcdef', auth: 'e2e-auth-key-01' };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const subscribe = (token: string, endpoint: string, application: INestApplication = app) =>
    request(application.getHttpServer()).post('/api/push/subscribe').set(auth(token)).send({ endpoint, keys });
  const notify = async (userId: number, organizationId: number, type: string, body = 'Corpo do aviso') => {
    await app
      .get(NotificationsService)
      .notifyUsers(organizationId, [userId], { title: '[e2e-push] Aviso', body, type });
    await app.get(PushService).drain();
  };

  before(async () => {
    appOff = await createTestApp();
    app = await createTestApp({ pushSender: sender });
    a = await createSecondOrg(app, prisma, 'push-a');
    b = await createSecondOrg(app, prisma, 'push-b');
  });

  after(async () => {
    const userIds = [a.userId, b.userId];
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.announcement.deleteMany({ where: { organizationId: { in: [a.organizationId, b.organizationId] } } });
    await prisma.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pushPreference.deleteMany({ where: { userId: { in: userIds } } });
    await a.cleanup();
    await b.cleanup();
    await prisma.$disconnect();
    await app.close();
    await appOff.close();
  });

  describe('sem VAPID (desligado)', () => {
    it('config informa enabled=false, subscribe responde 503 e nada quebra ao notificar', async () => {
      const config = await request(appOff.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
      assert.deepEqual(config.body, { enabled: false, publicKey: null });

      const res = await subscribe(a.token, endpointA, appOff);
      assert.equal(res.status, 503);
      assert.equal(await prisma.pushSubscription.count({ where: { userId: a.userId } }), 0);

      // A notificação in-app continua sendo gravada e o disparo de push é um no-op silencioso.
      await appOff
        .get(NotificationsService)
        .notifyUsers(a.organizationId, [a.userId], { title: '[e2e-push] Sem VAPID', body: 'x', type: 'ANNOUNCEMENT' });
      await appOff.get(PushService).drain();
      assert.equal(await prisma.notification.count({ where: { userId: a.userId, title: '[e2e-push] Sem VAPID' } }), 1);

      const del = await request(appOff.getHttpServer())
        .delete('/api/push/subscribe')
        .set(auth(a.token))
        .send({ endpoint: endpointA })
        .expect(200);
      assert.deepEqual(del.body, { removed: 0 });
    });
  });

  describe('autenticação', () => {
    it('401 sem token em todas as rotas', async () => {
      const server = app.getHttpServer();
      await request(server).get('/api/push/config').expect(401);
      await request(server).post('/api/push/subscribe').send({ endpoint: endpointA, keys }).expect(401);
      await request(server).delete('/api/push/subscribe').send({ endpoint: endpointA }).expect(401);
      await request(server).get('/api/push/preferences').expect(401);
      await request(server).put('/api/push/preferences').send({ lessons: false }).expect(401);
    });
  });

  describe('com remetente (ligado)', () => {
    it('config informa enabled=true e a chave pública', async () => {
      const res = await request(app.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
      assert.deepEqual(res.body, { enabled: true, publicKey: sender.publicKey });
    });

    it('subscribe é idempotente por endpoint e vincula ao usuário do token', async () => {
      await subscribe(a.token, endpointA).expect(201);
      await subscribe(a.token, endpointA).expect(201);
      const rows = await prisma.pushSubscription.findMany({ where: { endpoint: endpointA } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, a.userId);
      assert.equal(rows[0].organizationId, a.organizationId);

      // Aparelho compartilhado: o mesmo endpoint reinscrito por outro usuário passa a ser dele (continua 1 linha).
      await subscribe(b.token, endpointA).expect(201);
      const moved = await prisma.pushSubscription.findMany({ where: { endpoint: endpointA } });
      assert.equal(moved.length, 1);
      assert.equal(moved[0].userId, b.userId);
      await subscribe(a.token, endpointA).expect(201); // devolve para A
    });

    it('rejeita endpoint inseguro/interno e corpo sem chaves (400)', async () => {
      const server = app.getHttpServer();
      for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'nada']) {
        await request(server).post('/api/push/subscribe').set(auth(a.token)).send({ endpoint, keys }).expect(400);
      }
      await request(server).post('/api/push/subscribe').set(auth(a.token)).send({ endpoint: endpointB }).expect(400);
      await request(server)
        .post('/api/push/subscribe')
        .set(auth(a.token))
        .send({ endpoint: endpointB, keys, extra: 1 })
        .expect(400);
      assert.equal(await prisma.pushSubscription.count({ where: { endpoint: endpointB } }), 0);
    });

    it('notificação criada dispara push mínimo {title, body, url, tag}', async () => {
      const before = sender.to(endpointA).length;
      await notify(a.userId, a.organizationId, 'LESSON_CANCELLED', 'Aula de sábado cancelada');
      const sent = sender.to(endpointA);
      assert.equal(sent.length, before + 1);
      const payload = sent[sent.length - 1];
      assert.deepEqual(Object.keys(payload).sort(), ['body', 'tag', 'title', 'url']);
      assert.equal(payload.url, '/aulas');
      assert.equal(payload.tag, 'gingapp-lessons');
      const row = await prisma.pushSubscription.findUnique({ where: { endpoint: endpointA } });
      assert.ok(row?.lastUsedAt, 'lastUsedAt atualizado após o envio');
    });

    it('mensalidade vencida não vaza descrição nem valor no push', async () => {
      await notify(a.userId, a.organizationId, 'FINANCE_OVERDUE', 'Mensalidade 10/2026 (R$ 150,00) venceu em 10/10/2026.');
      const last = sender.to(endpointA).at(-1);
      assert.ok(last);
      assert.equal(last.url, '/financeiro');
      assert.ok(!/R\$|150/.test(last.body));
    });

    it('gatilho real: comunicado do grupo notifica por push o membro inscrito', async () => {
      await subscribe(b.token, endpointB).expect(201);
      const res = await request(app.getHttpServer())
        .post('/api/announcements')
        .set(auth(b.token))
        .send({ title: '[e2e-push] Comunicado', body: 'Reunião geral na sexta' })
        .expect(201);
      assert.ok(res.body.id);
      await app.get(PushService).drain();
      const got = sender.to(endpointB);
      assert.equal(got.length, 1);
      assert.equal(got[0].title, '[e2e-push] Comunicado');
      assert.equal(got[0].tag, 'gingapp-announcements');
    });

    it('preferências: padrão tudo ligado; PUT valida e persiste; categoria desligada não envia (a notificação in-app continua)', async () => {
      const server = app.getHttpServer();
      const defaults = await request(server).get('/api/push/preferences').set(auth(a.token)).expect(200);
      assert.deepEqual(defaults.body, { lessons: true, finance: true, events: true, graduations: true, announcements: true });

      await request(server).put('/api/push/preferences').set(auth(a.token)).send({ lessons: 'nao' }).expect(400);
      await request(server).put('/api/push/preferences').set(auth(a.token)).send({ outra: true }).expect(400);

      const updated = await request(server).put('/api/push/preferences').set(auth(a.token)).send({ lessons: false }).expect(200);
      assert.deepEqual(updated.body, { lessons: false, finance: true, events: true, graduations: true, announcements: true });

      const before = sender.to(endpointA).length;
      await notify(a.userId, a.organizationId, 'LESSON_CHANGED');
      assert.equal(sender.to(endpointA).length, before, 'aula desligada: nenhum push');
      assert.equal(await prisma.notification.count({ where: { userId: a.userId, type: 'LESSON_CHANGED' } }), 1);

      await notify(a.userId, a.organizationId, 'ANNOUNCEMENT'); // outra categoria continua ligada
      assert.equal(sender.to(endpointA).length, before + 1);

      // Preferência é por usuário: o usuário B não foi afetado.
      const other = await request(server).get('/api/push/preferences').set(auth(b.token)).expect(200);
      assert.equal(other.body.lessons, true);
    });

    it('410/404 do serviço de push removem a inscrição; erro 500 mantém', async () => {
      await subscribe(b.token, endpointB).expect(201);
      sender.failures.set(endpointB, 500);
      await notify(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { endpoint: endpointB } }), 1, '500 não remove');

      sender.failures.set(endpointB, 410);
      await notify(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { endpoint: endpointB } }), 0, '410 remove');

      await subscribe(b.token, endpointB).expect(201);
      sender.failures.set(endpointB, 404);
      await notify(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { endpoint: endpointB } }), 0, '404 remove');
      sender.failures.delete(endpointB);
      // A falha do push nunca derrubou a notificação in-app.
      assert.ok((await prisma.notification.count({ where: { userId: b.userId } })) >= 3);
    });

    it('DELETE remove só a inscrição do próprio usuário (idempotente)', async () => {
      const server = app.getHttpServer();
      const foreign = await request(server).delete('/api/push/subscribe').set(auth(b.token)).send({ endpoint: endpointA }).expect(200);
      assert.deepEqual(foreign.body, { removed: 0 });
      assert.equal(await prisma.pushSubscription.count({ where: { endpoint: endpointA } }), 1);

      const own = await request(server).delete('/api/push/subscribe').set(auth(a.token)).send({ endpoint: endpointA }).expect(200);
      assert.deepEqual(own.body, { removed: 1 });
      const again = await request(server).delete('/api/push/subscribe').set(auth(a.token)).send({ endpoint: endpointA }).expect(200);
      assert.deepEqual(again.body, { removed: 0 });
    });
  });
});
