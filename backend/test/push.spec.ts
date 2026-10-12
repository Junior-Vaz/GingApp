import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as webpush from 'web-push';
import {
  appOrigin,
  buildFcmMessage,
  isDeadFcmToken,
  readFirebaseAdminConfig,
  readFirebaseWebSettings,
} from '../src/shared/push/fcm.config';
import {
  buildPushPayload,
  isAcceptablePushEndpoint,
  pushCategoryOf,
  readVapidConfig,
} from '../src/shared/push/push.config';

/** Regras puras do Web Push (I13) — sem banco e sem rede. Nenhum push é enviado. */
describe('Web Push (unidade)', () => {
  const keys = webpush.generateVAPIDKeys();

  it('VAPID só liga com as três variáveis válidas; qualquer falha desliga sem erro', () => {
    assert.equal(readVapidConfig({}), null);
    const base = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:contato@gingapp.com.br' };
    assert.deepEqual(readVapidConfig(base), {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: 'mailto:contato@gingapp.com.br',
    });
    assert.equal(readVapidConfig({ ...base, VAPID_SUBJECT: '' }), null);
    assert.equal(readVapidConfig({ ...base, VAPID_SUBJECT: 'contato@gingapp.com.br' }), null); // sem mailto:
    assert.equal(readVapidConfig({ ...base, VAPID_PUBLIC_KEY: 'curta' }), null);
    assert.equal(readVapidConfig({ ...base, VAPID_PRIVATE_KEY: undefined }), null);
    assert.ok(readVapidConfig({ ...base, VAPID_SUBJECT: 'https://gingapp.com.br' }));
  });

  it('tipo da notificação -> categoria de preferência', () => {
    assert.equal(pushCategoryOf('LESSON_CANCELLED'), 'lessons');
    assert.equal(pushCategoryOf('LESSON_CHANGED'), 'lessons');
    assert.equal(pushCategoryOf('FINANCE_OVERDUE'), 'finance');
    assert.equal(pushCategoryOf('EVENT'), 'events');
    assert.equal(pushCategoryOf('RODA'), 'events');
    assert.equal(pushCategoryOf('GRADUATION'), 'graduations');
    assert.equal(pushCategoryOf('ANNOUNCEMENT'), 'announcements');
    assert.equal(pushCategoryOf('PLATFORM_ANNOUNCEMENT'), 'announcements');
    assert.equal(pushCategoryOf(null), 'announcements');
  });

  it('payload mínimo: só title/body/url/tag; mensalidade não vaza descrição nem valor; texto longo é cortado', () => {
    const finance = buildPushPayload({ title: 'Mensalidade vencida', body: 'Mensalidade 10/2026 (R$ 150,00) venceu em 10/10/2026.', type: 'FINANCE_OVERDUE' });
    assert.deepEqual(Object.keys(finance).sort(), ['body', 'tag', 'title', 'url']);
    assert.ok(!/R\$|150|10\/2026/.test(finance.body));
    assert.equal(finance.url, '/financeiro');
    assert.equal(finance.tag, 'gingapp-finance');

    const long = buildPushPayload({ title: 'Aviso', body: 'x'.repeat(500), type: 'ANNOUNCEMENT' });
    assert.ok(long.body.length <= 140);
    assert.equal(long.url, '/notificacoes');
  });

  describe('FCM (config e mensagem)', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----\n';
    const admin = { FIREBASE_PROJECT_ID: 'gingapp-prod', FIREBASE_CLIENT_EMAIL: 'svc@gingapp-prod.iam.gserviceaccount.com' };

    it('credenciais: aceita \\n escapado e aspas; JSON em base64 como alternativa; qualquer falha desliga', () => {
      assert.equal(readFirebaseAdminConfig({}), null);
      const escaped = readFirebaseAdminConfig({ ...admin, FIREBASE_PRIVATE_KEY: `"${pem.trim().replace(/\n/g, '\\n')}"` });
      assert.equal(escaped?.privateKey, pem.trim());
      assert.equal(escaped?.projectId, 'gingapp-prod');
      assert.ok(readFirebaseAdminConfig({ ...admin, FIREBASE_PRIVATE_KEY: pem }));
      assert.equal(readFirebaseAdminConfig({ ...admin, FIREBASE_PRIVATE_KEY: 'nao-e-pem' }), null);
      assert.equal(readFirebaseAdminConfig({ ...admin, FIREBASE_PRIVATE_KEY: pem, FIREBASE_CLIENT_EMAIL: 'sem-arroba' }), null);
      assert.equal(readFirebaseAdminConfig({ FIREBASE_CLIENT_EMAIL: admin.FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY: pem }), null);

      const json = JSON.stringify({ project_id: 'gingapp-prod', client_email: admin.FIREBASE_CLIENT_EMAIL, private_key: pem });
      const viaJson = readFirebaseAdminConfig({ FIREBASE_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString('base64') });
      assert.deepEqual(viaJson, { projectId: 'gingapp-prod', clientEmail: admin.FIREBASE_CLIENT_EMAIL, privateKey: pem.trim() });
      assert.equal(readFirebaseAdminConfig({ FIREBASE_SERVICE_ACCOUNT_JSON: 'lixo-que-nao-e-base64-de-json' }), null);
    });

    it('config web: exige os 5 campos; authDomain padrão; storageBucket opcional', () => {
      const web = {
        FIREBASE_PROJECT_ID: 'gingapp-prod',
        FIREBASE_WEB_API_KEY: 'AIzaKey',
        FIREBASE_WEB_MESSAGING_SENDER_ID: '123456789012',
        FIREBASE_WEB_APP_ID: '1:123456789012:web:abc',
        FIREBASE_WEB_VAPID_KEY: 'B'.padEnd(87, 'x'),
      };
      const ok = readFirebaseWebSettings(web);
      assert.equal(ok?.firebase.authDomain, 'gingapp-prod.firebaseapp.com');
      assert.equal(ok?.firebase.storageBucket, undefined);
      assert.equal(readFirebaseWebSettings({ ...web, FIREBASE_WEB_STORAGE_BUCKET: 'b.appspot.com' })?.firebase.storageBucket, 'b.appspot.com');
      for (const missing of ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'FIREBASE_WEB_MESSAGING_SENDER_ID', 'FIREBASE_WEB_APP_ID', 'FIREBASE_WEB_VAPID_KEY']) {
        assert.equal(readFirebaseWebSettings({ ...web, [missing]: '' }), null, `sem ${missing} desliga`);
      }
    });

    it('mensagem: data+notification mínimos, prioridade alta, TTL e link absoluto; só tokens mortos são removidos', () => {
      const payload = buildPushPayload({ title: 'Aula cancelada', body: 'Sábado', type: 'LESSON_CANCELLED' });
      const msg = buildFcmMessage(['t1', 't2'], payload, 'https://app.gingapp.com.br');
      assert.deepEqual(msg.tokens, ['t1', 't2']);
      assert.deepEqual(msg.notification, { title: 'Aula cancelada', body: 'Sábado' });
      assert.deepEqual(Object.keys(msg.data).sort(), ['body', 'tag', 'title', 'url']);
      assert.equal(msg.android.priority, 'high');
      assert.equal(msg.webpush.headers.Urgency, 'high');
      assert.equal(msg.webpush.headers.TTL, '86400');
      assert.equal(msg.webpush.fcmOptions?.link, 'https://app.gingapp.com.br/aulas');
      assert.equal(buildFcmMessage(['t1'], payload, null).webpush.fcmOptions, undefined);
      assert.equal(appOrigin({ APP_URL: 'https://app.gingapp.com.br/' }), 'https://app.gingapp.com.br');
      assert.equal(appOrigin({ APP_URL: 'javascript:alert(1)' }), null);

      assert.equal(isDeadFcmToken('messaging/registration-token-not-registered'), true);
      assert.equal(isDeadFcmToken('messaging/invalid-argument'), true);
      assert.equal(isDeadFcmToken('messaging/internal-error'), false);
      assert.equal(isDeadFcmToken('messaging/quota-exceeded'), false);
      assert.equal(isDeadFcmToken(undefined), false);
    });
  });

  it('endpoint de inscrição: só https público (sem IP, localhost, rede interna nem credenciais)', () => {
    assert.equal(isAcceptablePushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
    assert.equal(isAcceptablePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
    assert.equal(isAcceptablePushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
    assert.equal(isAcceptablePushEndpoint('https://127.0.0.1/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://10.0.0.5/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://localhost/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://[::1]/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://db.internal/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://meuservidor/x'), false);
    assert.equal(isAcceptablePushEndpoint('https://user:pass@fcm.googleapis.com/x'), false);
    assert.equal(isAcceptablePushEndpoint('nao-e-url'), false);
  });
});
