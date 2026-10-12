import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as webpush from 'web-push';
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
