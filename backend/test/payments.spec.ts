import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildExternalReference,
  mapMpPayment,
  mapMpStatus,
  mpPixPaymentBody,
  parseExternalReference,
} from '../src/shared/payments/mercadopago.mapping';
import {
  decryptProviderToken,
  encryptProviderToken,
  signOAuthState,
  verifyOAuthState,
  verifyWebhookSignature,
} from '../src/shared/payments/payment-crypto';
import {
  applicationFeeCents,
  assertPaymentsBootConfig,
  paymentsProviderKind,
  testModeAllowed,
  webhookNotificationUrl,
} from '../src/shared/payments/payments.config';
import { resolveJwtSecret } from '../src/shared/config/runtime-config';
import { aesGcmEncrypt, deriveSubkey } from '../src/shared/security/aes-gcm';

/** Pagamentos (PLANO_PROJETO.md 10.52): assinatura do webhook, cifra dos tokens, state do OAuth e mapeamento do MP. */
const SECRET = 'segredo-unit';
const sign = (manifest: string, secret = SECRET) => createHmac('sha256', secret).update(manifest).digest('hex');

describe('payments: assinatura do webhook (x-signature)', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const ts = String(now.getTime());
  const header = (v1: string, t = ts) => `ts=${t},v1=${v1}`;

  it('aceita a assinatura correta (ts em ms e em segundos)', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    assert.equal(verifyWebhookSignature({ secret: SECRET, signatureHeader: header(v1), requestId: 'req-1', dataId: '123', now }), 'OK');
    const tsSec = String(Math.floor(now.getTime() / 1000));
    const v1s = sign(`id:123;request-id:req-1;ts:${tsSec};`);
    assert.equal(verifyWebhookSignature({ secret: SECRET, signatureHeader: header(v1s, tsSec), requestId: 'req-1', dataId: '123', now }), 'OK');
  });

  it('id alfanumerico entra em minusculas; partes ausentes sao omitidas do manifesto', () => {
    const v1 = sign(`id:abc123;ts:${ts};`);
    assert.equal(verifyWebhookSignature({ secret: SECRET, signatureHeader: header(v1), requestId: null, dataId: 'ABC123', now }), 'OK');
  });

  it('recusa segredo errado, id/request-id trocados, cabecalho ausente/malformado e ts velho', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    const base = { secret: SECRET, requestId: 'req-1', dataId: '123', now };
    assert.equal(verifyWebhookSignature({ ...base, signatureHeader: header(sign(`id:123;request-id:req-1;ts:${ts};`, 'outro')) }), 'MISMATCH');
    assert.equal(verifyWebhookSignature({ ...base, dataId: '124', signatureHeader: header(v1) }), 'MISMATCH');
    assert.equal(verifyWebhookSignature({ ...base, requestId: 'req-2', signatureHeader: header(v1) }), 'MISMATCH');
    assert.equal(verifyWebhookSignature({ ...base, signatureHeader: undefined }), 'MISSING');
    assert.equal(verifyWebhookSignature({ ...base, signatureHeader: 'v1=abc' }), 'MALFORMED');
    const old = String(now.getTime() - 11 * 60 * 1000);
    const v1old = sign(`id:123;request-id:req-1;ts:${old};`);
    assert.equal(verifyWebhookSignature({ ...base, signatureHeader: header(v1old, old) }), 'EXPIRED');
  });
});

describe('payments: cifra dos tokens e state do OAuth', () => {
  const ctx = { organizationId: 7, provider: 'mercadopago' };

  it('token: ida e volta (v2 com AAD), IV novo a cada cifra, adulteracao detectada', () => {
    const a = encryptProviderToken('APP_USR-token-123', ctx);
    const b = encryptProviderToken('APP_USR-token-123', ctx);
    assert.notEqual(a, b);
    assert.match(a, /^v2:/);
    assert.ok(!a.includes('APP_USR'));
    assert.equal(decryptProviderToken(a, ctx), 'APP_USR-token-123');
    const parts = a.split(':');
    parts[3] = Buffer.from('xx').toString('base64');
    assert.throws(() => decryptProviderToken(parts.join(':'), ctx));
    // Tag truncada (authTagLength fixo em 16) e recusada.
    const short = a.split(':');
    short[2] = Buffer.from(short[2], 'base64').subarray(0, 8).toString('base64');
    assert.throws(() => decryptProviderToken(short.join(':'), ctx));
  });

  it('token: AAD amarra ao grupo/provedor (copiado para outro grupo nao decifra); v1 legado continua legivel', () => {
    const a = encryptProviderToken('APP_USR-token-123', ctx);
    assert.throws(() => decryptProviderToken(a, { organizationId: 8, provider: 'mercadopago' }));
    assert.throws(() => decryptProviderToken(a, { organizationId: 7, provider: 'stub' }));
    // v1 (sem AAD, formato anterior): mesma subchave, decifra em qualquer contexto.
    const masterKey = process.env.PAYMENTS_TOKEN_KEY?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
    const v1 = aesGcmEncrypt(deriveSubkey(masterKey, 'gingapp-payments-v1', 'provider-token'), 'APP_USR-legado');
    assert.match(v1, /^v1:/);
    assert.equal(decryptProviderToken(v1, ctx), 'APP_USR-legado');
  });

  it('boot: PAYMENTS_TOKEN_KEY exigida em producao SO com o Mercado Pago configurado; conta de teste so com flag', () => {
    const mp = {
      NODE_ENV: 'production',
      MERCADOPAGO_CLIENT_ID: 'id',
      MERCADOPAGO_CLIENT_SECRET: 'secret',
      MERCADOPAGO_REDIRECT_URI: 'https://api.x.com/api/payments/mercadopago/callback',
    };
    assert.throws(() => assertPaymentsBootConfig(mp), /PAYMENTS_TOKEN_KEY/);
    assert.doesNotThrow(() => assertPaymentsBootConfig({ ...mp, PAYMENTS_TOKEN_KEY: 'k'.repeat(40) }));
    assert.doesNotThrow(() => assertPaymentsBootConfig({ NODE_ENV: 'production' }));
    assert.doesNotThrow(() => assertPaymentsBootConfig({ ...mp, NODE_ENV: 'development' }));
    assert.equal(testModeAllowed({ NODE_ENV: 'production' }), false);
    assert.equal(testModeAllowed({ NODE_ENV: 'production', PAYMENTS_ALLOW_TEST_ACCOUNTS: 'true' }), true);
    assert.equal(testModeAllowed({ NODE_ENV: 'development' }), true);
  });

  it('state: valido volta o payload; adulterado, de outro formato ou expirado => null', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const state = signOAuthState({ organizationId: 7, userId: 9, provider: 'mercadopago', nonce: 'nonce-123456' }, now);
    assert.deepEqual(verifyOAuthState(state, now), { organizationId: 7, userId: 9, provider: 'mercadopago', nonce: 'nonce-123456' });
    const [payload, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ o: 8, u: 9, p: 'mercadopago', n: 'x', e: now.getTime() + 60000 })).toString('base64url');
    assert.equal(verifyOAuthState(`${forged}.${mac}`, now), null);
    assert.equal(verifyOAuthState(`${payload}.${mac}x`, now), null);
    assert.equal(verifyOAuthState('sem-ponto', now), null);
    assert.equal(verifyOAuthState(undefined, now), null);
    assert.equal(verifyOAuthState(state, new Date(now.getTime() + 11 * 60 * 1000)), null);
  });
});

describe('payments: mapeamento do Mercado Pago e configuracao', () => {
  it('external_reference: so `gingapp:<org>:<lancamento>` com ids validos', () => {
    assert.equal(buildExternalReference(3, 44), 'gingapp:3:44');
    assert.deepEqual(parseExternalReference('gingapp:3:44'), { organizationId: 3, financialRecordId: 44 });
    for (const bad of [null, '', 'gingapp:3', 'gingapp:0:1', 'gingapp:a:1', 'x:3:44', 'gingapp:3:44:1']) {
      assert.equal(parseExternalReference(bad), null, String(bad));
    }
  });

  it('corpo do Pix em reais, com idempotencia fora do corpo e taxa so quando > 0', () => {
    const body = mpPixPaymentBody({
      accessToken: 'x',
      amountCents: 15050,
      description: 'Mensalidade 10/2026',
      externalReference: 'gingapp:1:2',
      payerEmail: 'a@b.com',
      expiresAt: new Date('2026-10-21T15:00:00.000Z'),
      notificationUrl: null,
      applicationFeeCents: 0,
      idempotencyKey: 'k',
    });
    assert.equal(body.transaction_amount, 150.5);
    assert.equal(body.payment_method_id, 'pix');
    assert.equal(body.date_of_expiration, '2026-10-21T15:00:00.000+00:00');
    assert.ok(!('application_fee' in body) && !('notification_url' in body));
    assert.ok(!JSON.stringify(body).includes('"x"'), 'o token nunca vai no corpo');
  });

  it('resposta do pagamento: centavos, status normalizado e dados do Pix', () => {
    const p = mapMpPayment({
      id: 987,
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: 99.9,
      external_reference: 'gingapp:1:2',
      collector_id: 555,
      date_approved: '2026-10-20T10:00:00.000-04:00',
      point_of_interaction: { transaction_data: { qr_code: 'qr', qr_code_base64: 'b64', ticket_url: 'https://t' } },
    });
    assert.equal(p.id, '987');
    assert.equal(p.amountCents, 9990);
    assert.equal(p.status, 'APPROVED');
    assert.equal(p.collectorId, '555');
    assert.deepEqual(p.pix, { qrCode: 'qr', qrCodeBase64: 'b64', ticketUrl: 'https://t' });
    assert.equal(mapMpStatus('in_process'), 'PENDING');
    assert.equal(mapMpStatus('charged_back'), 'CHARGED_BACK');
    assert.equal(mapMpStatus('novo'), 'UNKNOWN');
  });

  it('config: stub proibido em producao; padrao por ambiente; URL do webhook derivada; taxa arredonda para baixo', () => {
    assert.throws(() => paymentsProviderKind({ NODE_ENV: 'production', PAYMENTS_PROVIDER: 'stub' }));
    assert.equal(paymentsProviderKind({ NODE_ENV: 'production' }), 'mercadopago');
    assert.equal(paymentsProviderKind({ NODE_ENV: 'development' }), 'stub');
    assert.throws(() => paymentsProviderKind({ PAYMENTS_PROVIDER: 'paypal' }));
    assert.equal(
      webhookNotificationUrl({ MERCADOPAGO_REDIRECT_URI: 'https://api.x.com/api/payments/mercadopago/callback' }),
      'https://api.x.com/api/webhooks/mercadopago?source_news=webhooks',
    );
    assert.equal(webhookNotificationUrl({ MERCADOPAGO_REDIRECT_URI: 'http://localhost:3000/api/payments/mercadopago/callback' }), null);
    assert.equal(applicationFeeCents(999, { PAYMENTS_APPLICATION_FEE_PERCENT: '2.5' }), 24);
    assert.equal(applicationFeeCents(999, {}), 0);
    assert.throws(() => applicationFeeCents(100, { PAYMENTS_APPLICATION_FEE_PERCENT: '80' }));
  });
});
