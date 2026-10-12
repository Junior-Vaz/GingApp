import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { decryptTwoFactorSecret } from '../src/shared/security/two-factor-crypto';
import { totpCode } from '../src/shared/security/totp';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createPlatformUser } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * 2FA TOTP opt-in (setup/enable/disable/verify). Grupo e usuarios PROPRIOS da suite (nao toca no seed ginga-brasil nem
 * no demo); o codigo e calculado no teste com a MESMA funcao RFC 6238 do servidor, lendo o segredo cifrado do Postgres.
 * Limpa tudo no after().
 */
const DOMAIN = '@e2e-2fa.local';
const STEP_MS = 30_000;

describe('2FA TOTP (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let orgId: number;
  let platformId: number;
  let platformEmail: string;
  const users: Record<string, { id: number; email: string; token: string }> = {};

  async function makeMember(key: string): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${stamp}${DOMAIN}`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-2fa] ${key}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    const login = await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200);
    users[key] = { id: user.id, email: user.email, token: login.body.accessToken };
  }

  /** Segredo REAL do usuario: o que o servidor guardou cifrado, decifrado com a mesma chave. */
  async function secretOf(userId: number): Promise<string> {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return decryptTwoFactorSecret(row.twoFactorSecret as string);
  }

  /** Ativa o 2FA do usuario (setup + enable, com o codigo do passo ANTERIOR) e devolve os codigos de recuperacao. */
  async function activate(key: string): Promise<string[]> {
    const setup = await http().post('/api/auth/2fa/setup').set(auth(users[key].token)).expect(200);
    assert.match(setup.body.qrCodeDataUrl, /^data:image\/png;base64,/);
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/GingApp:/);
    const secret = await secretOf(users[key].id);
    assert.equal(setup.body.secret, secret);
    const enable = await http()
      .post('/api/auth/2fa/enable')
      .set(auth(users[key].token))
      .send({ code: totpCode(secret, Date.now() - STEP_MS) })
      .expect(200);
    return enable.body.recoveryCodes as string[];
  }

  before(async () => {
    app = await createTestApp();
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E 2fa ${stamp}`, slug: `e2e-2fa-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    await makeMember('main');
    await makeMember('locked');
    await makeMember('plain');
    await makeMember('rec');
    const platform = await createPlatformUser(prisma, '2fa');
    platformId = platform.id;
    platformEmail = platform.email;
  });

  after(async () => {
    const ids = (
      await prisma.user.findMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { id: platformId }] }, select: { id: true } })
    ).map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId: { in: ids } }] } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('setup + enable: segredo cifrado em repouso, 8 codigos de recuperacao so como hash, /auth/me nunca devolve o segredo', async () => {
    const codes = await activate('main');
    assert.equal(codes.length, 8);
    assert.ok(codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)));

    const row = await prisma.user.findUniqueOrThrow({ where: { id: users.main.id } });
    assert.equal(row.twoFactorEnabled, true);
    assert.match(row.twoFactorSecret as string, /^v1:/, 'segredo cifrado (AES-GCM), nao em texto');
    assert.ok(!(row.twoFactorSecret as string).includes(await secretOf(users.main.id)));
    assert.equal(row.twoFactorRecoveryHashes.length, 8);
    assert.ok(codes.every((c) => !JSON.stringify(row.twoFactorRecoveryHashes).includes(c.replace('-', ''))));

    const me = await http().get('/api/auth/me').set(auth(users.main.token)).expect(200);
    assert.equal(me.body.twoFactorEnabled, true);
    assert.equal(me.body.recoveryCodesRemaining, 8);
    assert.ok(!JSON.stringify(me.body).includes('twoFactorSecret'));
    assert.ok(await prisma.auditLog.findFirst({ where: { userId: users.main.id, action: 'TWO_FACTOR_ENABLE' } }));

    // erros: ja ativo => 409; enable sem setup => 400; codigo mal formado => 400
    await http().post('/api/auth/2fa/setup').set(auth(users.main.token)).expect(409);
    await http().post('/api/auth/2fa/enable').set(auth(users.plain.token)).send({ code: '123456' }).expect(400);
    await http().post('/api/auth/2fa/enable').set(auth(users.plain.token)).send({ code: '12' }).expect(400);
  });

  it('login com 2FA: devolve desafio (sem accessToken), o desafio nao vale como token, codigo errado/repetido = 400, codigo certo = sessao', async () => {
    const login = await http().post('/api/auth/login').send({ email: users.main.email, password: DEV_PASSWORD }).expect(200);
    assert.equal(login.body.twoFactorRequired, true);
    assert.equal(login.body.accessToken, undefined);
    const challengeToken = login.body.challengeToken as string;
    await http().get('/api/auth/me').set(auth(challengeToken)).expect(401); // o desafio nao e um accessToken

    const secret = await secretOf(users.main.id);
    await http().post('/api/auth/2fa/verify').send({ challengeToken, code: '000000' }).expect(400);
    await http().post('/api/auth/2fa/verify').send({ challengeToken: 'lixo', code: '123456' }).expect(400);

    const good = totpCode(secret); // passo atual (maior que o do enable, que usou o anterior)
    const ok = await http().post('/api/auth/2fa/verify').send({ challengeToken, code: good }).expect(200);
    assert.ok(ok.body.accessToken);
    assert.equal(ok.body.user.email, users.main.email);
    await http().get('/api/auth/me').set(auth(ok.body.accessToken)).expect(200);

    // anti-replay: o mesmo codigo nao vale duas vezes; o passo seguinte (dentro da janela) vale
    const again = await http().post('/api/auth/login').send({ email: users.main.email, password: DEV_PASSWORD }).expect(200);
    await http().post('/api/auth/2fa/verify').send({ challengeToken: again.body.challengeToken, code: good }).expect(400);
    await http()
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: again.body.challengeToken, code: totpCode(secret, Date.now() + STEP_MS) })
      .expect(200);
  });

  it('codigo de recuperacao vale uma unica vez; desativar exige senha + segundo fator e limpa tudo', async () => {
    const codes = await activate('rec');
    const login = await http().post('/api/auth/login').send({ email: users.rec.email, password: DEV_PASSWORD }).expect(200);
    await http()
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: login.body.challengeToken, recoveryCode: codes[0].toUpperCase() })
      .expect(200);
    await http().post('/api/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, recoveryCode: codes[0] }).expect(400);
    const me = await http().get('/api/auth/me').set(auth(users.rec.token)).expect(200);
    assert.equal(me.body.recoveryCodesRemaining, 7);
    assert.ok(await prisma.auditLog.findFirst({ where: { userId: users.rec.id, action: 'TWO_FACTOR_RECOVERY_USED' } }));

    // erros: senha errada => 400 (nunca 401); senha certa sem segundo fator => 400
    await http().post('/api/auth/2fa/disable').set(auth(users.rec.token)).send({ password: 'errada', recoveryCode: codes[1] }).expect(400);
    await http().post('/api/auth/2fa/disable').set(auth(users.rec.token)).send({ password: DEV_PASSWORD }).expect(400);

    await http().post('/api/auth/2fa/disable').set(auth(users.rec.token)).send({ password: DEV_PASSWORD, recoveryCode: codes[1] }).expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: users.rec.id } });
    assert.deepEqual(
      [row.twoFactorEnabled, row.twoFactorSecret, row.twoFactorRecoveryHashes.length, row.twoFactorLastStep],
      [false, null, 0, null],
    );
    const plain = await http().post('/api/auth/login').send({ email: users.rec.email, password: DEV_PASSWORD }).expect(200);
    assert.ok(plain.body.accessToken, 'sem 2FA o login volta a ser direto');
    assert.ok(await prisma.auditLog.findFirst({ where: { userId: users.rec.id, action: 'TWO_FACTOR_DISABLE' } }));
  });

  it('bloqueio por falhas: apos 5 codigos errados o usuario recebe 429, mesmo com o codigo certo', async () => {
    await activate('locked');
    const secret = await secretOf(users.locked.id);
    const login = await http().post('/api/auth/login').send({ email: users.locked.email, password: DEV_PASSWORD }).expect(200);
    for (let i = 0; i < 5; i += 1) {
      await http().post('/api/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, code: '000000' }).expect(400);
    }
    await http().post('/api/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, code: totpCode(secret) }).expect(429);
    assert.equal(await prisma.auditLog.count({ where: { userId: users.locked.id, action: 'TWO_FACTOR_FAILURE' } }), 5);
  });

  it('equipe da plataforma: platform-login tambem exige o segundo passo', async () => {
    const pre = await http().post('/api/auth/platform-login').send({ email: platformEmail, password: DEV_PASSWORD }).expect(200);
    assert.ok(pre.body.accessToken);
    users.plat = { id: platformId, email: platformEmail, token: pre.body.accessToken };
    await activate('plat');
    const login = await http().post('/api/auth/platform-login').send({ email: platformEmail, password: DEV_PASSWORD }).expect(200);
    assert.equal(login.body.twoFactorRequired, true);
    const secret = await secretOf(platformId);
    const ok = await http().post('/api/auth/2fa/verify').send({ challengeToken: login.body.challengeToken, code: totpCode(secret) }).expect(200);
    assert.equal(ok.body.user.userType, 'PLATFORM');
    assert.equal(ok.body.user.organizationId, undefined);
  });
});
