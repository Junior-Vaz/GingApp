import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  hotp,
  totpCode,
  verifyTotp,
} from '../src/shared/security/totp';
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  findRecoveryHash,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../src/shared/security/two-factor-crypto';
import { buildRequestLogLine, requestLogMiddleware, REQUEST_ID_HEADER } from '../src/shared/observability/request-log.middleware';
import { auditRetentionDays, isAuditRetentionEnabled } from '../src/jobs/audit-retention-cron.service';
import { uploadsGcMode } from '../src/jobs/uploads-gc-cron.service';

/** Regras puras do 2FA (TOTP RFC 6238, cifra, recuperacao), do log de requisicao e dos flags dos jobs - sem banco. */
describe('TOTP (RFC 4226/6238)', () => {
  // Segredo ASCII "12345678901234567890" dos apendices das RFCs.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('vetores oficiais: HOTP (RFC 4226) e TOTP SHA-1 (RFC 6238, ultimos 6 digitos)', () => {
    assert.equal(hotp(secret, 0), '755224');
    assert.equal(hotp(secret, 1), '287082');
    assert.equal(totpCode(secret, 59_000), '287082'); // T=59 s -> 94287082
    assert.equal(totpCode(secret, 1_111_111_109_000), '081804'); // 07081804
    assert.deepEqual(base32Decode(secret), Buffer.from('12345678901234567890'));
  });

  it('verifyTotp: janela de +-1 passo devolve o passo; fora da janela ou mal formado = null', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    assert.equal(verifyTotp(secret, totpCode(secret, now), now), step);
    assert.equal(verifyTotp(secret, totpCode(secret, now - 30_000), now), step - 1);
    assert.equal(verifyTotp(secret, totpCode(secret, now + 30_000), now), step + 1);
    assert.equal(verifyTotp(secret, totpCode(secret, now + 90_000), now), null);
    assert.equal(verifyTotp(secret, '12345', now), null);
    assert.equal(verifyTotp(secret, 'abcdef', now), null);
  });

  it('URI otpauth carrega segredo, emissor e e-mail codificado', () => {
    const uri = buildOtpAuthUri('ABC234', 'ana+x@exemplo.com');
    assert.match(uri, /^otpauth:\/\/totp\/GingApp:ana%2Bx%40exemplo\.com\?/);
    assert.match(uri, /secret=ABC234/);
    assert.match(uri, /issuer=GingApp/);
  });
});

describe('cifra do segredo e codigos de recuperacao', () => {
  it('AES-GCM: ida e volta, IV novo a cada cifra, adulteracao detectada', () => {
    const a = encryptTwoFactorSecret('JBSWY3DPEHPK3PXP');
    const b = encryptTwoFactorSecret('JBSWY3DPEHPK3PXP');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('v1:') && !a.includes('JBSWY3DPEHPK3PXP'));
    assert.equal(decryptTwoFactorSecret(a), 'JBSWY3DPEHPK3PXP');
    const parts = a.split(':');
    parts[3] = Buffer.from('adulterado').toString('base64');
    assert.throws(() => decryptTwoFactorSecret(parts.join(':')));
  });

  it('recuperacao: 8 codigos distintos; o hash ignora caixa/hifen e nao revela o codigo', () => {
    const codes = generateRecoveryCodes();
    assert.equal(new Set(codes).size, 8);
    const hashes = codes.map(hashRecoveryCode);
    assert.equal(findRecoveryHash(hashes, codes[3].toUpperCase().replace('-', ' ')), 3);
    assert.equal(findRecoveryHash(hashes, 'zzzzz-zzzzz'), -1);
    assert.ok(hashes.every((h, i) => /^[0-9a-f]{64}$/.test(h) && !h.includes(codes[i].replace('-', ''))));
  });
});

describe('log de requisicao (REQUEST_LOG) e X-Request-Id', () => {
  function run(headers: Record<string, string>, enabled: boolean, status = 200) {
    process.env.REQUEST_LOG = enabled ? 'true' : 'false';
    const lines: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      statusCode: status,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
    });
    const req = {
      method: 'GET',
      headers,
      ip: '10.0.0.9',
      baseUrl: '',
      route: { path: '/api/students/:id' },
      originalUrl: '/api/students/42?token=SEGREDO',
      user: { id: 7 },
    };
    requestLogMiddleware((l) => lines.push(l))(req as never, res as never, () => undefined);
    res.emit('finish');
    delete process.env.REQUEST_LOG;
    return { lines, res, req };
  }

  it('ligado: uma linha JSON com metodo, rota-padrao, status, ms e requestId; sem querystring/ids/headers', () => {
    const { lines, res } = run({ authorization: 'Bearer SEGREDO' }, true);
    assert.equal(lines.length, 1);
    const line = JSON.parse(lines[0]);
    assert.deepEqual(
      [line.msg, line.method, line.route, line.status, line.level, line.userId],
      ['http_request', 'GET', '/api/students/:id', 200, 'info', 7],
    );
    assert.equal(line.requestId, res.headers[REQUEST_ID_HEADER]);
    assert.equal(typeof line.ms, 'number');
    assert.ok(!lines[0].includes('SEGREDO') && !lines[0].includes('42'));
  });

  it('desligado: sem log, mas o X-Request-Id sai (proprio ou o do cliente se inofensivo; lixo e trocado)', () => {
    const own = run({}, false);
    assert.equal(own.lines.length, 0);
    assert.match(own.res.headers[REQUEST_ID_HEADER], /^[0-9a-f-]{36}$/);
    assert.equal(run({ 'x-request-id': 'abc-12345678' }, false).res.headers[REQUEST_ID_HEADER], 'abc-12345678');
    assert.match(run({ 'x-request-id': 'x\ninjetado' }, false).res.headers[REQUEST_ID_HEADER], /^[0-9a-f-]{36}$/);
    const unmatched = buildRequestLogLine({ method: 'GET', ip: 'x' } as never, { statusCode: 404 } as never, 'id', 1);
    assert.equal(unmatched.route, 'unmatched');
    assert.equal(unmatched.level, 'warn');
  });
});

describe('flags dos jobs semanais', () => {
  it('retencao da auditoria: padrao 365 dias, 0 = nunca, invalido volta ao padrao; AUDIT_RETENTION_CRON=false desliga', () => {
    assert.equal(auditRetentionDays({}), 365);
    assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: '90' }), 90);
    assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: '0' }), 0);
    assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: '-5' }), 365);
    assert.equal(auditRetentionDays({ AUDIT_RETENTION_DAYS: 'abc' }), 365);
    assert.equal(isAuditRetentionEnabled({}), true);
    assert.equal(isAuditRetentionEnabled({ AUDIT_RETENTION_CRON: 'false' }), false);
  });

  it('imagens orfas: ligado por padrao; UPLOADS_GC=false desliga; dry-run so registra', () => {
    assert.equal(uploadsGcMode({}), 'on');
    assert.equal(uploadsGcMode({ UPLOADS_GC: 'false' }), 'off');
    assert.equal(uploadsGcMode({ UPLOADS_GC: 'dry-run' }), 'dry-run');
  });
});
