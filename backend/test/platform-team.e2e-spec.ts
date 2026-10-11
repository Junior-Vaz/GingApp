import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import {
  TEAM_DOMAIN,
  TeamFixtureUser,
  createMemberSuperAdmin,
  createPlatformUser,
  memberLogin,
  platformLogin,
} from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * /platform-team (1/2): quem pode o quê, listagem e criação. As regras de mutação (auto-alteração,
 * último super admin, revogar sessões, resetar senha) ficam em platform-team-manage.e2e-spec.ts.
 *
 * Nunca altera o owner do seed; cria os próprios usuários (sufixo @e2e-team.local) e os apaga.
 * Nada depende de contagem global: X-Total-Count é comparado com o Prisma no mesmo instante.
 */
const FIELDS = ['createdAt', 'email', 'id', 'isSuperAdmin', 'name', 'phone', 'status', 'tokenValidAfter'];
const FORBIDDEN_FIELDS = ['passwordHash', 'twoFactorSecret', 'password', 'userType'];

describe('Platform team — acesso, listagem e criação (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let superUser: TeamFixtureUser;
  let plainUser: TeamFixtureUser;
  let inactiveUser: TeamFixtureUser;
  let memberSuper: Awaited<ReturnType<typeof createMemberSuperAdmin>>;
  let superToken: string;
  let plainToken: string;
  const apiCreatedIds: number[] = [];

  const call = (method: 'get' | 'post' | 'patch', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/platform-team${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  before(async () => {
    app = await createTestApp();
    superUser = await createPlatformUser(prisma, 'list-super', { isSuperAdmin: true });
    plainUser = await createPlatformUser(prisma, 'list-plain');
    inactiveUser = await createPlatformUser(prisma, 'list-inactive', { status: 'INACTIVE' });
    memberSuper = await createMemberSuperAdmin(prisma, 'list');
    superToken = await platformLogin(app, superUser.email);
    plainToken = await platformLogin(app, plainUser.email);
  });

  after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [superUser.id, plainUser.id, inactiveUser.id, ...apiCreatedIds] }, email: { endsWith: TEAM_DOMAIN } },
    });
    await memberSuper.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem token => 401 em todos os endpoints', async () => {
    await call('get', '').expect(401);
    await call('post', '').send({}).expect(401);
    await call('patch', '/1').send({}).expect(401);
    await call('post', '/1/revoke-sessions').expect(401);
    await call('post', '/1/reset-password').send({ password: 'x'.repeat(12) }).expect(401);
  });

  it('MEMBER (MESTRE) => 403 em todos os endpoints', async () => {
    const { token } = await loginAs(app, MESTRE_EMAIL);
    await call('get', '', token).expect(403);
    await call('post', '', token).send({ name: 'Fulano', email: `mestre-try@${TEAM_DOMAIN}`, password: 'x'.repeat(12) }).expect(403);
    await call('patch', `/${superUser.id}`, token).send({ name: 'Hack' }).expect(403);
    await call('post', `/${superUser.id}/revoke-sessions`, token).expect(403);
    await call('post', `/${superUser.id}/reset-password`, token).send({ password: 'x'.repeat(12) }).expect(403);
    assert.equal(await prisma.user.count({ where: { email: `mestre-try@${TEAM_DOMAIN}` } }), 0);
  });

  it('MEMBER com isSuperAdmin=true também recebe 403 (o guard exige userType PLATFORM)', async () => {
    const token = await memberLogin(app, memberSuper.email);
    await call('get', '', token).expect(403);
    await call('post', '', token).send({ name: 'Fulano', email: `ms-try@${TEAM_DOMAIN}`, password: 'x'.repeat(12) }).expect(403);
    assert.equal(await prisma.user.count({ where: { email: `ms-try@${TEAM_DOMAIN}` } }), 0);
  });

  it('PLATFORM não-super lista (200): só campos permitidos, nunca hash/2FA, nunca MEMBER', async () => {
    const res = await call('get', '?limit=200', plainToken).expect(200);
    assert.ok(Array.isArray(res.body));

    const expectedTotal = await prisma.user.count({ where: { userType: 'PLATFORM' } });
    assert.equal(Number(res.headers['x-total-count']), expectedTotal);

    for (const row of res.body) {
      assert.deepEqual(Object.keys(row).sort(), FIELDS);
      for (const forbidden of FORBIDDEN_FIELDS) assert.ok(!(forbidden in row), `${forbidden} vazou`);
    }
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('$2b$'), 'nenhum hash bcrypt na resposta');

    const ids = new Set(res.body.map((u: { id: number }) => u.id));
    assert.ok(ids.has(superUser.id) && ids.has(plainUser.id) && ids.has(inactiveUser.id));
    assert.ok(!ids.has(memberSuper.id), 'usuário MEMBER (mesmo isSuperAdmin) nunca aparece');
    const members = await prisma.user.findMany({ where: { userType: 'MEMBER' }, select: { id: true } });
    assert.ok(members.every((m) => !ids.has(m.id)));
  });

  it('filtros: q (nome/e-mail, case-insensitive), status e paginação', async () => {
    const byEmail = await call('get', `?q=${encodeURIComponent(plainUser.email.toUpperCase())}`, plainToken).expect(200);
    assert.deepEqual(byEmail.body.map((u: { id: number }) => u.id), [plainUser.id]);

    const byName = await call('get', `?q=${encodeURIComponent('e2e team list-inactive')}`, plainToken).expect(200);
    assert.ok(byName.body.some((u: { id: number }) => u.id === inactiveUser.id));

    const inactive = await call('get', '?status=INACTIVE&limit=200', plainToken).expect(200);
    const expectedInactive = await prisma.user.count({ where: { userType: 'PLATFORM', status: 'INACTIVE' } });
    assert.equal(Number(inactive.headers['x-total-count']), expectedInactive);
    assert.ok(inactive.body.every((u: { status: string }) => u.status === 'INACTIVE'));
    assert.ok(inactive.body.some((u: { id: number }) => u.id === inactiveUser.id));

    const page = await call('get', '?q=@e2e-team.local&limit=1&offset=1', plainToken).expect(200);
    assert.equal(page.body.length, 1);
    assert.equal(
      Number(page.headers['x-total-count']),
      await prisma.user.count({ where: { userType: 'PLATFORM', email: { contains: '@e2e-team.local' } } }),
    );

    await call('get', '?status=BANNED', plainToken).expect(400);
    await call('get', '?limit=999', plainToken).expect(400);
  });

  it('PLATFORM não-super NÃO cria/altera/revoga/reseta (403) e nada muda no banco', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: inactiveUser.id } });
    await call('post', '', plainToken)
      .send({ name: 'Fulano', email: `plain-try@${TEAM_DOMAIN}`, password: 'x'.repeat(12) })
      .expect(403);
    await call('patch', `/${inactiveUser.id}`, plainToken).send({ status: 'ACTIVE', name: 'Hack' }).expect(403);
    await call('post', `/${inactiveUser.id}/revoke-sessions`, plainToken).expect(403);
    await call('post', `/${inactiveUser.id}/reset-password`, plainToken).send({ password: 'y'.repeat(12) }).expect(403);

    assert.equal(await prisma.user.count({ where: { email: `plain-try@${TEAM_DOMAIN}` } }), 0);
    const afterRow = await prisma.user.findUniqueOrThrow({ where: { id: inactiveUser.id } });
    assert.equal(afterRow.status, before.status);
    assert.equal(afterRow.name, before.name);
    assert.equal(afterRow.passwordHash, before.passwordHash);
    assert.equal(afterRow.tokenValidAfter, null);
  });

  it('super admin cria (201): resposta sem hash/2FA, e-mail em minúsculas, PLATFORM no banco, login funciona', async () => {
    const email = `E2E-Team-Api-${Date.now()}@${TEAM_DOMAIN}`;
    const password = 'SenhaForte#2026';
    const res = await call('post', '', superToken)
      .send({ name: '  Maria Nova  ', email, phone: '11999990000', password })
      .expect(201);
    apiCreatedIds.push(res.body.id);

    assert.deepEqual(Object.keys(res.body).sort(), FIELDS);
    assert.equal(res.body.email, email.toLowerCase());
    assert.equal(res.body.name, 'Maria Nova');
    assert.equal(res.body.phone, '11999990000');
    assert.equal(res.body.status, 'ACTIVE');
    assert.equal(res.body.isSuperAdmin, false);
    assert.equal(res.body.tokenValidAfter, null);
    assert.ok(!JSON.stringify(res.body).includes(password), 'a senha nunca volta na resposta');

    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(row.userType, 'PLATFORM');
    assert.notEqual(row.passwordHash, password);
    assert.ok(row.passwordHash.startsWith('$2'), 'hash bcrypt');
    assert.equal(await bcrypt.compare(password, row.passwordHash), true);

    // login com o e-mail normalizado + a senha definida
    await platformLogin(app, email.toLowerCase(), password);

    const sup = await call('post', '', superToken)
      .send({ name: 'Super Nova', email: `e2e-team-api-super-${Date.now()}@${TEAM_DOMAIN}`, password, isSuperAdmin: true })
      .expect(201);
    apiCreatedIds.push(sup.body.id);
    assert.equal(sup.body.isSuperAdmin, true);
  });

  it('e-mail duplicado => 409 (inclusive só diferindo em caixa, e e-mail de um MEMBER)', async () => {
    const password = 'SenhaForte#2026';
    await call('post', '', superToken).send({ name: 'Dup', email: plainUser.email, password }).expect(409);
    await call('post', '', superToken)
      .send({ name: 'Dup', email: plainUser.email.toUpperCase(), password })
      .expect(409);
    await call('post', '', superToken).send({ name: 'Dup', email: MESTRE_EMAIL, password }).expect(409);
    assert.equal(await prisma.user.count({ where: { email: { equals: plainUser.email, mode: 'insensitive' } } }), 1);
    assert.equal(await prisma.user.count({ where: { userType: 'MEMBER', email: MESTRE_EMAIL } }), 1);
  });

  it('validação da criação => 400 (senha < 12 ou Dev@12345, nome/e-mail ausentes ou inválidos, campo extra)', async () => {
    const email = `e2e-team-invalid-${Date.now()}@${TEAM_DOMAIN}`;
    const ok = { name: 'Valido', email, password: 'SenhaForte#2026' };
    await call('post', '', superToken).send({ ...ok, password: '123456789' }).expect(400); // 9 caracteres
    await call('post', '', superToken).send({ ...ok, password: '1234567890' }).expect(400); // 10: antes passava
    await call('post', '', superToken).send({ ...ok, password: '12345678901' }).expect(400); // 11
    await call('post', '', superToken).send({ ...ok, password: 'Dev@12345' }).expect(400); // senha padrão
    await call('post', '', superToken).send({ ...ok, password: 'xxDEV@12345xx' }).expect(400); // embutida, qualquer caixa
    await call('post', '', superToken).send({ ...ok, password: 'x'.repeat(73) }).expect(400);
    await call('post', '', superToken).send({ email, password: ok.password }).expect(400);
    await call('post', '', superToken).send({ ...ok, email: 'nao-e-email' }).expect(400);
    await call('post', '', superToken).send({ ...ok, userType: 'MEMBER' }).expect(400);
    await call('post', '', superToken).send({ ...ok, isSuperAdmin: 'sim' }).expect(400);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
    // com exatamente 12 caracteres passa (mínimo da política SSOT)
    const edge = await call('post', '', superToken).send({ ...ok, password: '123456789012' }).expect(201);
    apiCreatedIds.push(edge.body.id);
  });
});
