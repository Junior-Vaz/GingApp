import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { NotificationsService } from '../src/interface/http/notifications/notifications.service';
import { PushService } from '../src/shared/push/push.service';
import { SecondOrg, createSecondOrg } from './utils/list-helpers';
import { MemoryFcmSender, MemoryPushSender, createTestApp } from './utils/test-app';

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
      assert.deepEqual(config.body, { enabled: false, provider: null, publicKey: null, firebase: null });

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
      assert.deepEqual(res.body, { enabled: true, provider: 'webpush', publicKey: sender.publicKey, firebase: null });
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

  // ---------------------------------------------------------------------------------------------
  // FCM (transporte principal). Remetente em memória: nenhum Firebase real. A config web vem de env em runtime.
  // ---------------------------------------------------------------------------------------------
  describe('FCM (provider fcm)', () => {
    const fcm = new MemoryFcmSender();
    const vapidKey = 'B'.padEnd(87, 'x'); // forma de uma chave Web Push do FCM (base64url, 87 caracteres)
    const webEnv: Record<string, string> = {
      FIREBASE_PROJECT_ID: 'gingapp-e2e',
      FIREBASE_WEB_API_KEY: 'AIza-e2e-api-key',
      FIREBASE_WEB_MESSAGING_SENDER_ID: '123456789012',
      FIREBASE_WEB_APP_ID: '1:123456789012:web:e2eappid',
      FIREBASE_WEB_VAPID_KEY: vapidKey,
    };
    const saved: Record<string, string | undefined> = {};
    let appFcm: INestApplication; // só FCM
    let appBoth: INestApplication; // FCM + Web Push VAPID
    const tokA = `e2e-fcm-token-a-${stamp}-aaaaaaaaaaaa`;
    const tokA2 = `e2e-fcm-token-a2-${stamp}-aaaaaaaaaa`;
    const tokB = `e2e-fcm-token-b-${stamp}-bbbbbbbbbbbb`;
    const subscribeFcm = (token: string, tokenValue: string, application: INestApplication = appFcm, extra: object = {}) =>
      request(application.getHttpServer())
        .post('/api/push/subscribe')
        .set(auth(token))
        .send({ provider: 'fcm', token: tokenValue, platform: 'web', ...extra });
    const notifyFcm = async (userId: number, organizationId: number, type: string, body = 'Corpo do aviso') => {
      await appFcm.get(NotificationsService).notifyUsers(organizationId, [userId], { title: '[e2e-push] Aviso FCM', body, type });
      await appFcm.get(PushService).drain();
    };

    before(async () => {
      for (const [name, value] of Object.entries(webEnv)) {
        saved[name] = process.env[name];
        process.env[name] = value;
      }
      // Os testes de Web Push acima deixam preferências alteradas: volta ao padrão (tudo ligado).
      await prisma.pushPreference.deleteMany({ where: { userId: { in: [a.userId, b.userId] } } });
      appFcm = await createTestApp({ fcmSender: fcm });
      appBoth = await createTestApp({ fcmSender: fcm, pushSender: sender });
    });

    after(async () => {
      for (const [name, value] of Object.entries(saved)) process.env[name] = value ?? '';
      await appFcm.close();
      await appBoth.close();
    });

    it('config informa provider fcm, a chave VAPID do FCM e a config web (authDomain padrão)', async () => {
      const res = await request(appFcm.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
      assert.deepEqual(res.body, {
        enabled: true,
        provider: 'fcm',
        publicKey: vapidKey,
        firebase: {
          apiKey: 'AIza-e2e-api-key',
          authDomain: 'gingapp-e2e.firebaseapp.com',
          projectId: 'gingapp-e2e',
          messagingSenderId: '123456789012',
          appId: '1:123456789012:web:e2eappid',
        },
      });
      // Com os dois configurados o FCM é o principal; sem a config web cai para o Web Push VAPID.
      const both = await request(appBoth.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
      assert.equal(both.body.provider, 'fcm');
      process.env.FIREBASE_WEB_API_KEY = '';
      try {
        const fallback = await request(appBoth.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
        assert.deepEqual(fallback.body, { enabled: true, provider: 'webpush', publicKey: sender.publicKey, firebase: null });
        const off = await request(appFcm.getHttpServer()).get('/api/push/config').set(auth(a.token)).expect(200);
        assert.deepEqual(off.body, { enabled: false, provider: null, publicKey: null, firebase: null });
      } finally {
        process.env.FIREBASE_WEB_API_KEY = webEnv.FIREBASE_WEB_API_KEY;
      }
    });

    it('401 sem token em /push/test e em /push/config', async () => {
      await request(appFcm.getHttpServer()).post('/api/push/test').expect(401);
      await request(appFcm.getHttpServer()).get('/api/push/config').expect(401);
    });

    it('subscribe por token é idempotente, vincula ao usuário e o aparelho compartilhado muda de dono', async () => {
      await subscribeFcm(a.token, tokA).expect(201);
      await subscribeFcm(a.token, tokA).expect(201);
      const rows = await prisma.pushSubscription.findMany({ where: { token: tokA } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, a.userId);
      assert.equal(rows[0].organizationId, a.organizationId);
      assert.equal(rows[0].provider, 'fcm');
      assert.equal(rows[0].endpoint, null);

      await subscribeFcm(b.token, tokA).expect(201);
      const moved = await prisma.pushSubscription.findMany({ where: { token: tokA } });
      assert.equal(moved.length, 1);
      assert.equal(moved[0].userId, b.userId);
      await subscribeFcm(a.token, tokA).expect(201);
      await subscribeFcm(b.token, tokB).expect(201);
    });

    it('rejeita corpo inválido (400): fcm sem token, token malformado, transporte desconhecido', async () => {
      const server = appFcm.getHttpServer();
      await request(server).post('/api/push/subscribe').set(auth(a.token)).send({ provider: 'fcm' }).expect(400);
      await subscribeFcm(a.token, 'curto').expect(400);
      await subscribeFcm(a.token, 'token com espaco e acento é inválido!!').expect(400);
      await subscribeFcm(a.token, tokA2, appFcm, { platform: 'palm' }).expect(400);
      await request(server).post('/api/push/subscribe').set(auth(a.token)).send({ provider: 'sms', token: tokA2 }).expect(400);
      await request(server).delete('/api/push/subscribe').set(auth(a.token)).send({}).expect(400);
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokA2 } }), 0);
    });

    it('o formato Web Push (endpoint + keys) continua válido quando o VAPID também está configurado', async () => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-push-both-${stamp}`;
      await request(appBoth.getHttpServer()).post('/api/push/subscribe').set(auth(a.token)).send({ endpoint, keys }).expect(201);
      const row = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      assert.equal(row?.provider, 'webpush');
      assert.equal(row?.token, null);
      await prisma.pushSubscription.delete({ where: { endpoint } });
    });

    it('notificação criada dispara FCM mínimo {title, body, url, tag}; mensalidade não vaza descrição nem valor', async () => {
      const before = fcm.to(tokA).length;
      await notifyFcm(a.userId, a.organizationId, 'LESSON_CANCELLED', 'Aula de sábado cancelada');
      const sent = fcm.to(tokA);
      assert.equal(sent.length, before + 1);
      const payload = sent[sent.length - 1];
      assert.deepEqual(Object.keys(payload).sort(), ['body', 'tag', 'title', 'url']);
      assert.equal(payload.url, '/aulas');
      assert.equal(payload.tag, 'gingapp-lessons');
      assert.ok((await prisma.pushSubscription.findUnique({ where: { token: tokA } }))?.lastUsedAt);

      await notifyFcm(a.userId, a.organizationId, 'FINANCE_OVERDUE', 'Mensalidade 10/2026 (R$ 150,00) venceu em 10/10/2026.');
      const finance = fcm.to(tokA).at(-1);
      assert.ok(finance);
      assert.equal(finance.url, '/financeiro');
      assert.ok(!/R\$|150/.test(finance.body));
    });

    it('vários aparelhos do mesmo usuário recebem no MESMO multicast', async () => {
      await subscribeFcm(a.token, tokA2).expect(201);
      const calls = fcm.calls.length;
      await notifyFcm(a.userId, a.organizationId, 'ANNOUNCEMENT', 'Reunião na sexta');
      assert.equal(fcm.calls.length, calls + 1);
      const call = fcm.calls.at(-1)!;
      assert.deepEqual([...call.tokens].sort(), [tokA, tokA2].sort());
      await prisma.pushSubscription.deleteMany({ where: { token: tokA2 } });
    });

    it('preferência desligada não envia (a notificação in-app continua)', async () => {
      await request(appFcm.getHttpServer()).put('/api/push/preferences').set(auth(a.token)).send({ events: false }).expect(200);
      const before = fcm.to(tokA).length;
      await notifyFcm(a.userId, a.organizationId, 'EVENT');
      assert.equal(fcm.to(tokA).length, before, 'eventos desligados: nenhum FCM');
      assert.equal(await prisma.notification.count({ where: { userId: a.userId, type: 'EVENT' } }), 1);
      await notifyFcm(a.userId, a.organizationId, 'LESSON_CHANGED'); // outra categoria segue ligada
      assert.equal(fcm.to(tokA).length, before + 1);
    });

    it('token que o FCM recusa (not-registered / invalid-argument) é removido; erro transitório e falha geral mantêm', async () => {
      await subscribeFcm(b.token, tokB).expect(201);
      fcm.failures.set(tokB, 'messaging/internal-error');
      await notifyFcm(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokB } }), 1, 'erro transitório não remove');

      fcm.failAll = true;
      await notifyFcm(b.userId, b.organizationId, 'ANNOUNCEMENT');
      fcm.failAll = false;
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokB } }), 1, 'falha do serviço não remove');

      fcm.failures.set(tokB, 'messaging/registration-token-not-registered');
      await notifyFcm(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokB } }), 0, 'not-registered remove');

      await subscribeFcm(b.token, tokB).expect(201);
      fcm.failures.set(tokB, 'messaging/invalid-argument');
      await notifyFcm(b.userId, b.organizationId, 'ANNOUNCEMENT');
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokB } }), 0, 'invalid-argument remove');
      fcm.failures.delete(tokB);
      assert.ok((await prisma.notification.count({ where: { userId: b.userId, title: '[e2e-push] Aviso FCM' } })) >= 4);
    });

    it('limite de 10 aparelhos por usuário: o mais antigo é descartado e o recém-inscrito fica', async () => {
      const tokens = Array.from({ length: 11 }, (_, i) => `e2e-fcm-token-cap-${stamp}-${String(i).padStart(2, '0')}-cccccc`);
      for (const t of tokens) await subscribeFcm(a.token, t).expect(201);
      assert.equal(await prisma.pushSubscription.count({ where: { userId: a.userId } }), 10);
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokens[10] } }), 1, 'o último fica');
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokA } }), 0, 'o mais antigo saiu');
      await prisma.pushSubscription.deleteMany({ where: { userId: a.userId } });
      await subscribeFcm(a.token, tokA).expect(201);
    });

    it('POST /push/test avisa só os aparelhos do PRÓPRIO usuário (ignora preferências) e informa o resultado', async () => {
      await subscribeFcm(b.token, tokB).expect(201);
      await request(appFcm.getHttpServer()).put('/api/push/preferences').set(auth(a.token)).send({ announcements: false }).expect(200);
      const beforeA = fcm.to(tokA).length;
      const beforeB = fcm.to(tokB).length;
      const res = await request(appFcm.getHttpServer()).post('/api/push/test').set(auth(a.token)).expect(200);
      assert.deepEqual(res.body, { sent: 1, devices: 1 });
      assert.equal(fcm.to(tokA).length, beforeA + 1);
      assert.equal(fcm.to(tokB).length, beforeB, 'o aparelho de outro usuário não é avisado');
      const payload = fcm.to(tokA).at(-1)!;
      assert.equal(payload.tag, 'gingapp-test');
      assert.deepEqual(Object.keys(payload).sort(), ['body', 'tag', 'title', 'url']);

      // Sem aparelhos inscritos: 200 com devices=0 (o app orienta a ativar primeiro).
      await prisma.pushSubscription.deleteMany({ where: { userId: b.userId } });
      const none = await request(appFcm.getHttpServer()).post('/api/push/test').set(auth(b.token)).expect(200);
      assert.deepEqual(none.body, { sent: 0, devices: 0 });
    });

    it('DELETE por token remove só a inscrição do próprio usuário (idempotente)', async () => {
      const server = appFcm.getHttpServer();
      const foreign = await request(server).delete('/api/push/subscribe').set(auth(b.token)).send({ token: tokA }).expect(200);
      assert.deepEqual(foreign.body, { removed: 0 });
      assert.equal(await prisma.pushSubscription.count({ where: { token: tokA } }), 1);
      const own = await request(server).delete('/api/push/subscribe').set(auth(a.token)).send({ token: tokA }).expect(200);
      assert.deepEqual(own.body, { removed: 1 });
      const again = await request(server).delete('/api/push/subscribe').set(auth(a.token)).send({ token: tokA }).expect(200);
      assert.deepEqual(again.body, { removed: 0 });
    });

    it('rate limit do aviso de teste (limite rebaixado, app novo = contador zerado) responde 429', async () => {
      const previous = process.env.PUSH_TEST_THROTTLE_LIMIT;
      process.env.PUSH_TEST_THROTTLE_LIMIT = '2';
      const limited = await createTestApp({ fcmSender: fcm });
      try {
        const post = () => request(limited.getHttpServer()).post('/api/push/test').set(auth(a.token));
        await post().expect(200);
        await post().expect(200);
        await post().expect(429);
      } finally {
        process.env.PUSH_TEST_THROTTLE_LIMIT = previous ?? '1000';
        await limited.close();
      }
    });
  });

  describe('sem nenhum transporte (tudo desligado)', () => {
    it('subscribe fcm e /push/test respondem 503 e a config informa provider null', async () => {
      const server = appOff.getHttpServer();
      const config = await request(server).get('/api/push/config').set(auth(a.token)).expect(200);
      assert.equal(config.body.provider, null);
      await request(server)
        .post('/api/push/subscribe')
        .set(auth(a.token))
        .send({ provider: 'fcm', token: `e2e-fcm-token-off-${stamp}-dddddddd` })
        .expect(503);
      await request(server).post('/api/push/test').set(auth(a.token)).expect(503);
      assert.equal(await prisma.pushSubscription.count({ where: { userId: a.userId } }), 0);
    });
  });
});
