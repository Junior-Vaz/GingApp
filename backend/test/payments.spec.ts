import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildExternalReference,
  liveModeFromAccessToken,
  mapMpPayment,
  mapMpUser,
  mapMpStatus,
  mpPixPaymentBody,
  parseExternalReference,
} from '../src/shared/payments/mercadopago.mapping';
import {
  decryptProviderToken,
  decryptProviderTokenWithRotation,
  encryptProviderToken,
  signOAuthState,
  verifyOAuthState,
  verifyWebhookSignature,
} from '../src/shared/payments/payment-crypto';
import {
  applicationFeeCents,
  assertPaymentsBootConfig,
  groupWebhookUrl,
  oauthAvailable,
  parseWebhookOrg,
  paymentsAvailable,
  paymentsProviderKind,
  testModeAllowed,
  webhookNotificationUrl,
  webhookUnsignedLimits,
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
    // Segredo do webhook (10.55): AAD proprio - trocado de coluna com o token nao decifra.
    const hook = encryptProviderToken('segredo-do-webhook', { ...ctx, purpose: 'webhook-secret' });
    assert.equal(decryptProviderToken(hook, { ...ctx, purpose: 'webhook-secret' }), 'segredo-do-webhook');
    assert.throws(() => decryptProviderToken(hook, ctx));
    assert.throws(() => decryptProviderToken(a, { ...ctx, purpose: 'webhook-secret' }));
    // v1 (sem AAD, formato anterior): mesma subchave, decifra em qualquer contexto.
    const masterKey = process.env.PAYMENTS_TOKEN_KEY?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
    const v1 = aesGcmEncrypt(deriveSubkey(masterKey, 'gingapp-payments-v1', 'provider-token'), 'APP_USR-legado');
    assert.match(v1, /^v1:/);
    assert.equal(decryptProviderToken(v1, ctx), 'APP_USR-legado');
  });

  it('chave dos tokens (10.56, M2): definir PAYMENTS_TOKEN_KEY DEPOIS / rotacionar com _PREVIOUS nao quebra; sem chave valida lanca', () => {
    const saved = { key: process.env.PAYMENTS_TOKEN_KEY, prev: process.env.PAYMENTS_TOKEN_KEY_PREVIOUS, jwt: process.env.JWT_SECRET };
    const restore = () => {
      for (const [k, v] of [['PAYMENTS_TOKEN_KEY', saved.key], ['PAYMENTS_TOKEN_KEY_PREVIOUS', saved.prev], ['JWT_SECRET', saved.jwt]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    try {
      delete process.env.PAYMENTS_TOKEN_KEY;
      delete process.env.PAYMENTS_TOKEN_KEY_PREVIOUS;
      process.env.JWT_SECRET = 'jwt-unit-antigo-' + 'x'.repeat(40);
      const viaJwt = encryptProviderToken('APP_USR-token-jwt', ctx);
      assert.deepEqual(decryptProviderTokenWithRotation(viaJwt, ctx), { plain: 'APP_USR-token-jwt', rotated: false });
      // Define a chave DEPOIS: a antiga (derivada do JWT) ainda decifra e pede rotacao.
      process.env.PAYMENTS_TOKEN_KEY = 'k1'.repeat(32);
      assert.deepEqual(decryptProviderTokenWithRotation(viaJwt, ctx), { plain: 'APP_USR-token-jwt', rotated: true });
      const viaK1 = encryptProviderToken('APP_USR-token-k1', ctx);
      assert.deepEqual(decryptProviderTokenWithRotation(viaK1, ctx), { plain: 'APP_USR-token-k1', rotated: false });
      // Rotaciona K1 -> K2 guardando K1 em _PREVIOUS e troca o JWT: K1 ainda decifra (rotated); o derivado do JWT antigo nao.
      process.env.PAYMENTS_TOKEN_KEY = 'k2'.repeat(32);
      process.env.PAYMENTS_TOKEN_KEY_PREVIOUS = 'k1'.repeat(32);
      process.env.JWT_SECRET = 'jwt-unit-novo-' + 'y'.repeat(40);
      assert.deepEqual(decryptProviderTokenWithRotation(viaK1, ctx), { plain: 'APP_USR-token-k1', rotated: true });
      assert.throws(() => decryptProviderToken(viaJwt, ctx), 'JWT rotacionado sem a chave antiga: ilegivel (a conta vira ERROR no uso)');
    } finally {
      restore();
    }
  });

  it('boot (10.55): NADA do Mercado Pago e exigido no ambiente (PAYMENTS_TOKEN_KEY opcional); stub em producao ainda falha', () => {
    const mp = {
      NODE_ENV: 'production',
      MERCADOPAGO_CLIENT_ID: 'id',
      MERCADOPAGO_CLIENT_SECRET: 'secret',
      MERCADOPAGO_REDIRECT_URI: 'https://api.x.com/api/payments/mercadopago/callback',
    };
    assert.doesNotThrow(() => assertPaymentsBootConfig(mp));
    assert.doesNotThrow(() => assertPaymentsBootConfig({ ...mp, PAYMENTS_TOKEN_KEY: 'k'.repeat(40) }));
    assert.doesNotThrow(() => assertPaymentsBootConfig({ NODE_ENV: 'production' }));
    assert.doesNotThrow(() => assertPaymentsBootConfig({ ...mp, NODE_ENV: 'development' }));
    assert.throws(() => assertPaymentsBootConfig({ NODE_ENV: 'production', PAYMENTS_PROVIDER: 'stub' }), /stub/);
    // Disponivel sem credencial nenhuma; OAuth so com as 3 envs (https em producao).
    assert.equal(paymentsAvailable({ NODE_ENV: 'production' }), true);
    assert.equal(paymentsAvailable({ NODE_ENV: 'development' }), true);
    assert.equal(paymentsAvailable({ PAYMENTS_PROVIDER: 'paypal' }), false);
    assert.equal(oauthAvailable({ NODE_ENV: 'production' }), false);
    assert.equal(oauthAvailable(mp), true);
    assert.equal(oauthAvailable({ ...mp, MERCADOPAGO_REDIRECT_URI: 'http://api.x.com/cb' }), false);
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
    assert.deepEqual(mapMpUser({ id: 123456, nickname: 'GRUPO' }), { providerUserId: '123456', nickname: 'GRUPO' });
    assert.throws(() => mapMpUser({ nickname: 'sem id' }));
    assert.equal(mapMpStatus('in_process'), 'PENDING');
    assert.equal(mapMpStatus('charged_back'), 'CHARGED_BACK');
    assert.equal(mapMpStatus('novo'), 'UNKNOWN');
  });

  it('config: stub proibido em producao; padrao por ambiente; URL do webhook derivada; taxa arredonda para baixo', () => {
    assert.throws(() => paymentsProviderKind({ NODE_ENV: 'production', PAYMENTS_PROVIDER: 'stub' }));
    assert.equal(paymentsProviderKind({ NODE_ENV: 'production' }), 'mercadopago');
    assert.equal(paymentsProviderKind({ NODE_ENV: 'development' }), 'stub');
    assert.throws(() => paymentsProviderKind({ PAYMENTS_PROVIDER: 'paypal' }));
    // 10.55: URL do webhook DO GRUPO a partir de PAINEL_URL (?org=<id>); compat com MERCADOPAGO_REDIRECT_URI.
    assert.equal(
      webhookNotificationUrl(42, { PAINEL_URL: 'https://painel.x.com/' }),
      'https://painel.x.com/api/webhooks/mercadopago?org=42&source_news=webhooks',
    );
    assert.equal(groupWebhookUrl(42, { PAINEL_URL: 'https://painel.x.com' }), 'https://painel.x.com/api/webhooks/mercadopago?org=42');
    // 10.56 (B9): base sem https nao e mostrada como utilizavel (o provedor nao entrega em http).
    assert.equal(groupWebhookUrl(42, { PAINEL_URL: 'http://localhost:4174' }), null);
    assert.equal(webhookNotificationUrl(42, { PAINEL_URL: 'http://localhost:4174' }), null, 'notification_url so https');
    assert.equal(groupWebhookUrl(42, {}), null);
    assert.equal(
      webhookNotificationUrl(7, { MERCADOPAGO_REDIRECT_URI: 'https://api.x.com/api/payments/mercadopago/callback' }),
      'https://api.x.com/api/webhooks/mercadopago?org=7&source_news=webhooks',
    );
    assert.equal(webhookNotificationUrl(7, { MERCADOPAGO_REDIRECT_URI: 'http://localhost:3000/api/payments/mercadopago/callback' }), null);
    assert.equal(parseWebhookOrg('15'), 15);
    for (const bad of [undefined, '', '0', '-1', '1.5', 'abc', '99999999999', ['1'], '2147483648']) {
      assert.equal(parseWebhookOrg(bad), null, String(bad));
    }
    // Heuristica UNICA de teste x producao do token colado (a confirmacao real e o live_mode do pagamento).
    assert.equal(liveModeFromAccessToken('TEST-123-abc-999'), false);
    assert.equal(liveModeFromAccessToken('APP_USR-123-abc-999'), true);
    assert.equal(applicationFeeCents(999, { PAYMENTS_APPLICATION_FEE_PERCENT: '2.5' }), 24);
    assert.equal(applicationFeeCents(999, {}), 0);
    // 10.56 (M5): limites dos gatilhos sem assinatura (por processo), ajustaveis por env.
    assert.deepEqual(webhookUnsignedLimits({}), { known: 120, unknown: 10, cooldownMs: 5000 });
    assert.deepEqual(
      webhookUnsignedLimits({ WEBHOOK_UNSIGNED_KNOWN_ORG_LIMIT: '5', WEBHOOK_UNSIGNED_ORG_LIMIT: '1', WEBHOOK_UNSIGNED_COOLDOWN_MS: '0' }),
      { known: 5, unknown: 1, cooldownMs: 0 },
    );
    assert.equal(webhookUnsignedLimits({ WEBHOOK_UNSIGNED_ORG_LIMIT: 'abc' }).unknown, 10);
    assert.throws(() => applicationFeeCents(100, { PAYMENTS_APPLICATION_FEE_PERCENT: '80' }));
  });
});
