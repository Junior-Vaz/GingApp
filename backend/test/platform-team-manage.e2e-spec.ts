import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MESTRE_EMAIL } from './utils/list-helpers';
import {
  TEAM_DOMAIN,
  TeamFixtureUser,
  createMemberSuperAdmin,
  createPlatformUser,
  platformLogin,
  sleep,
} from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * /platform-team (2/2): regras de mutação. PATCH (nome/telefone/status/isSuperAdmin), regras de
 * auto-alteração, corrida entre dois super admins (a plataforma não pode ficar sem super admin
 * ativo), revoke-sessions e reset-password (token antigo invalidado via tokenValidAfter).
 *
 * O owner do seed nunca é alterado: todos os atores/alvos são usuários criados aqui
 * (@e2e-team.local) e apagados no after().
 */
describe('Platform team — mutações e regras de segurança (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let s1: TeamFixtureUser; // super admin ator
  let s2: TeamFixtureUser; // super admin, alvo de rebaixamento/desativação
  let target: TeamFixtureUser; // PLATFORM comum
  let resetTarget: TeamFixtureUser; // PLATFORM comum só para reset-password
  let memberUser: Awaited<ReturnType<typeof createMemberSuperAdmin>>;
  let s1Token: string;
  let s2Token: string;
  const raceUserIds: number[] = [];

  const call = (method: 'get' | 'post' | 'patch', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api/platform-team${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const dbUser = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });

  before(async () => {
    app = await createTestApp();
    s1 = await createPlatformUser(prisma, 'manage-s1', { isSuperAdmin: true });
    s2 = await createPlatformUser(prisma, 'manage-s2', { isSuperAdmin: true });
    target = await createPlatformUser(prisma, 'manage-target');
    resetTarget = await createPlatformUser(prisma, 'manage-reset');
    memberUser = await createMemberSuperAdmin(prisma, 'manage');
    s1Token = await platformLogin(app, s1.email);
    s2Token = await platformLogin(app, s2.email);
  });

  after(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [s1.id, s2.id, target.id, resetTarget.id, ...raceUserIds] }, email: { endsWith: TEAM_DOMAIN } },
    });
    await memberUser.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('PATCH por super admin: nome, telefone (null limpa), status e isSuperAdmin; resposta sem hash/2FA', async () => {
    const res = await call('patch', `/${target.id}`, s1Token)
      .send({ name: '  Nome Editado  ', phone: '11988887777' })
      .expect(200);
    assert.equal(res.body.name, 'Nome Editado');
    assert.equal(res.body.phone, '11988887777');
    assert.ok(!('passwordHash' in res.body) && !('twoFactorSecret' in res.body));

    const cleared = await call('patch', `/${target.id}`, s1Token).send({ phone: null }).expect(200);
    assert.equal(cleared.body.phone, null);

    const promoted = await call('patch', `/${target.id}`, s1Token).send({ isSuperAdmin: true }).expect(200);
    assert.equal(promoted.body.isSuperAdmin, true);
    await call('patch', `/${target.id}`, s1Token).send({ isSuperAdmin: false }).expect(200);
    assert.equal((await dbUser(target.id)).isSuperAdmin, false);
  });

  it('PATCH inválido => 400 (status fora do enum, null em campos obrigatórios, campo extra, id não numérico)', async () => {
    await call('patch', `/${target.id}`, s1Token).send({ status: 'BANNED' }).expect(400);
    await call('patch', `/${target.id}`, s1Token).send({ status: null }).expect(400);
    await call('patch', `/${target.id}`, s1Token).send({ name: null }).expect(400);
    await call('patch', `/${target.id}`, s1Token).send({ email: 'novo@x.com' }).expect(400);
    await call('patch', `/${target.id}`, s1Token).send({ passwordHash: 'x' }).expect(400);
    await call('patch', '/abc', s1Token).send({}).expect(400);
  });

  it('alvo inexistente ou usuário MEMBER => 404 (nunca expõe/edita MEMBER)', async () => {
    const memberBefore = await dbUser(memberUser.id);
    await call('patch', '/99999999', s1Token).send({ name: 'Xx' }).expect(404);
    await call('patch', `/${memberUser.id}`, s1Token).send({ name: 'Hack', status: 'INACTIVE' }).expect(404);
    await call('post', `/${memberUser.id}/revoke-sessions`, s1Token).expect(404);
    await call('post', `/${memberUser.id}/reset-password`, s1Token).send({ password: 'SenhaForte#2026' }).expect(404);
    const memberAfter = await dbUser(memberUser.id);
    assert.equal(memberAfter.status, memberBefore.status);
    assert.equal(memberAfter.passwordHash, memberBefore.passwordHash);
    assert.equal(memberAfter.tokenValidAfter, null);
    const mestre = await prisma.user.findUniqueOrThrow({ where: { email: MESTRE_EMAIL } });
    await call('patch', `/${mestre.id}`, s1Token).send({ name: 'Hack' }).expect(404);
  });

  it('ninguém altera o PRÓPRIO status nem o próprio isSuperAdmin (403); nome e valores iguais passam', async () => {
    await call('patch', `/${s1.id}`, s1Token).send({ status: 'INACTIVE' }).expect(403);
    await call('patch', `/${s1.id}`, s1Token).send({ isSuperAdmin: false }).expect(403);
    await call('patch', `/${s1.id}`, s1Token).send({ name: 'Novo', status: 'INACTIVE' }).expect(403);
    let row = await dbUser(s1.id);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.isSuperAdmin, true);
    assert.notEqual(row.name, 'Novo', 'a requisição rejeitada não aplica nenhum campo');

    // no-op (mesmos valores) e edição de nome/telefone do próprio perfil continuam permitidos
    await call('patch', `/${s1.id}`, s1Token).send({ status: 'ACTIVE', isSuperAdmin: true, name: 'S1 Renomeado' }).expect(200);
    row = await dbUser(s1.id);
    assert.equal(row.name, 'S1 Renomeado');
  });

  it('super admin rebaixa e desativa OUTRO super admin; token do desativado cai na hora', async () => {
    // rebaixar: S2 continua logado, mas deixa de poder gerir a equipe
    await call('patch', `/${s2.id}`, s1Token).send({ isSuperAdmin: false }).expect(200);
    await call('patch', `/${target.id}`, s2Token).send({ name: 'Por S2' }).expect(403);
    await call('get', '', s2Token).expect(200); // listar segue permitido para PLATFORM não-super
    await prisma.user.update({ where: { id: s2.id }, data: { isSuperAdmin: true } });

    // desativar: 401 imediato (JwtStrategy) e tokenValidAfter preenchido (reativar não ressuscita tokens)
    const res = await call('patch', `/${s2.id}`, s1Token).send({ status: 'INACTIVE' }).expect(200);
    assert.equal(res.body.status, 'INACTIVE');
    assert.ok(res.body.tokenValidAfter);
    await call('get', '', s2Token).expect(401);

    await call('patch', `/${s2.id}`, s1Token).send({ status: 'ACTIVE' }).expect(200);
    await call('get', '', s2Token).expect(401); // token antigo segue morto após reativar
    await sleep(1100);
    s2Token = await platformLogin(app, s2.email);
    await call('get', '', s2Token).expect(200);
  });

  it('corrida: dois super admins se rebaixando ao mesmo tempo => exatamente um vence (a plataforma nunca zera)', async () => {
    for (let round = 0; round < 4; round++) {
      const a = await createPlatformUser(prisma, `race-a${round}`, { isSuperAdmin: true });
      const b = await createPlatformUser(prisma, `race-b${round}`, { isSuperAdmin: true });
      raceUserIds.push(a.id, b.id);
      const [ta, tb] = await Promise.all([platformLogin(app, a.email), platformLogin(app, b.email)]);

      const [r1, r2] = await Promise.all([
        call('patch', `/${b.id}`, ta).send({ isSuperAdmin: false }),
        call('patch', `/${a.id}`, tb).send({ isSuperAdmin: false }),
      ]);

      assert.deepEqual([r1.status, r2.status].sort(), [200, 403], `rodada ${round}: ${r1.status}/${r2.status}`);
      const rows = await prisma.user.findMany({ where: { id: { in: [a.id, b.id] } } });
      assert.equal(rows.filter((u) => u.isSuperAdmin && u.status === 'ACTIVE').length, 1, 'sobra exatamente 1 super admin');
    }
  });

  it('revoke-sessions: tokenValidAfter = agora; token antigo => 401; novo login funciona', async () => {
    const oldToken = await platformLogin(app, target.email);
    await call('get', '', oldToken).expect(200);

    const res = await call('post', `/${target.id}/revoke-sessions`, s1Token).expect(200);
    assert.ok(res.body.tokenValidAfter);
    assert.ok(Math.abs(Date.now() - new Date(res.body.tokenValidAfter).getTime()) < 10_000);
    assert.deepEqual(Object.keys(res.body).sort(), [
      'createdAt', 'email', 'id', 'isSuperAdmin', 'name', 'phone', 'status', 'tokenValidAfter',
    ]);
    await call('get', '', oldToken).expect(401);

    await sleep(1100); // o iat do JWT tem resolução de 1s; o novo token precisa nascer depois do corte
    const fresh = await platformLogin(app, target.email);
    await call('get', '', fresh).expect(200);
  });

  it('reset-password: novo hash, token antigo invalidado, senha antiga recusada, nova funciona; nada vaza', async () => {
    const newPassword = 'NovaSenha#Forte2026';
    const before = await dbUser(resetTarget.id);
    const oldToken = await platformLogin(app, resetTarget.email);
    await call('get', '', oldToken).expect(200);

    await call('post', `/${resetTarget.id}/reset-password`, s1Token).send({ password: 'curta' }).expect(400);
    // Política SSOT (12..72 bytes, sem Dev@12345): 10/11 caracteres e a senha padrão são recusados.
    for (const weak of ['1234567890', '12345678901', 'Dev@12345', 'DEV@12345-extra']) {
      await call('post', `/${resetTarget.id}/reset-password`, s1Token).send({ password: weak }).expect(400);
    }
    await call('post', `/${resetTarget.id}/reset-password`, s1Token).send({ password: newPassword, extra: 1 }).expect(400);
    assert.equal((await dbUser(resetTarget.id)).passwordHash, before.passwordHash, 'rejeições não alteram o hash');

    const res = await call('post', `/${resetTarget.id}/reset-password`, s1Token).send({ password: newPassword }).expect(200);
    assert.ok(!JSON.stringify(res.body).includes(newPassword));
    assert.ok(!('passwordHash' in res.body) && !('password' in res.body));
    assert.ok(res.body.tokenValidAfter);

    const after = await dbUser(resetTarget.id);
    assert.notEqual(after.passwordHash, before.passwordHash);
    assert.equal(await bcrypt.compare(newPassword, after.passwordHash), true);
    assert.equal(await bcrypt.compare('Dev@12345', after.passwordHash), false);

    await call('get', '', oldToken).expect(401); // token emitido antes do reset
    await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: resetTarget.email, password: 'Dev@12345' })
      .expect(401);

    await sleep(1100);
    const fresh = await platformLogin(app, resetTarget.email, newPassword);
    await call('get', '', fresh).expect(200);
  });

  it('super admin troca a PRÓPRIA senha por reset-password (permitido); a sessão antiga cai', async () => {
    await call('post', `/${s2.id}/reset-password`, s2Token).send({ password: 'OutraSenha#2026' }).expect(200);
    await call('get', '', s2Token).expect(401);
  });
});
