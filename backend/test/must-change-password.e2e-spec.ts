import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createPlatformUser, platformLogin, TEAM_DOMAIN, TEAM_PASSWORD } from './utils/platform-team-fixtures';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';

/**
 * mustChangePassword IMPOSTO NO SERVIDOR (JwtAuthGuard + @AllowDuringGate): com a flag ligada o usuário só
 * consegue trocar a senha e consultar o próprio perfil (GET /auth/me); toda outra rota autenticada devolve
 * 403 com `code: MUST_CHANGE_PASSWORD`. A flag é lida do BANCO a cada requisição (não do token).
 * Fixtures: alunos "[e2e-mcp] ..." e e-mails "@e2e-mcp.local", removidos no after().
 */
const TEMP = 'Prov@Senha2026x';
const DEFINITIVA = 'Definitiva@2026z';
const DOMAIN = '@e2e-mcp.local';
const CODE = 'MUST_CHANGE_PASSWORD';

describe('mustChangePassword no servidor (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  const stamp = `${Date.now()}`;
  let seq = 0;
  const email = (kind: string) => `${kind}-${stamp}-${++seq}${DOMAIN}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(emailAddr: string, password: string) {
    const res = await http().post('/api/auth/login').send({ email: emailAddr, password }).expect(200);
    return res.body as { accessToken: string; user: { mustChangePassword: boolean } };
  }
  /** Aluno com conta criada pelo Mestre (senha provisória => mustChangePassword true). */
  async function studentWithAccount() {
    const student = await http().post('/api/students').set(auth(mestre.token)).send({ name: `[e2e-mcp] Aluno ${++seq}` }).expect(201);
    const e = email('aluno');
    await http().post(`/api/students/${student.body.id}/account`).set(auth(mestre.token)).send({ email: e, password: TEMP }).expect(201);
    return { studentId: student.body.id as number, email: e };
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    mestre = await loginAs(app, MESTRE_EMAIL);
  });

  after(async () => {
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-mcp]' } }, select: { id: true } });
    const studentIds = students.map((s) => s.id);
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    const users = await prisma.user.findMany({
      where: { OR: [{ email: { endsWith: DOMAIN } }, { name: { startsWith: '[e2e-mcp]' } }] },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${TEAM_DOMAIN}` }, name: 'E2E Team mcp' } });
    await prisma.$disconnect();
    await app.close();
  });

  it('com a flag ligada, qualquer rota autenticada devolve 403 com code MUST_CHANGE_PASSWORD; só /auth/me e /auth/change-password passam', async () => {
    const { email: e, studentId } = await studentWithAccount();
    const session = await login(e, TEMP);
    assert.equal(session.user.mustChangePassword, true);
    const token = session.accessToken;

    // Rotas de leitura e escrita variadas (do app do aluno): todas barradas ANTES de qualquer lógica.
    const blockedGets = ['/api/students/me', '/api/notifications', '/api/announcements', '/api/attendance/me', '/api/finance/me', '/api/passport/me'];
    for (const path of blockedGets) {
      const res = await http().get(path).set(auth(token)).expect(403);
      assert.equal(res.body.code, CODE, path);
      assert.equal(res.body.statusCode, 403);
      assert.match(res.body.message, /trocar a senha/);
    }
    const post = await http().post('/api/events/1/participants').set(auth(token)).send({}).expect(403);
    assert.equal(post.body.code, CODE);
    const patch = await http().patch('/api/students/me/profile').set(auth(token)).send({ photo: 'https://x.test/a.jpg' }).expect(403);
    assert.equal(patch.body.code, CODE);
    const del = await http().delete(`/api/students/${studentId}`).set(auth(token)).expect(403);
    assert.equal(del.body.code, CODE);

    // Sem token continua 401 (não 403); rotas públicas seguem abertas.
    await http().get('/api/students/me').expect(401);
    await http().get('/api/health').expect(200);
    await http().get('/api/legal').expect(200);

    // Liberadas: o próprio perfil...
    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(me.body.mustChangePassword, true);
    assert.equal(me.body.email, e);
    assert.equal(me.body.role, 'ALUNO');
    // ...e a troca de senha (que limpa a flag e devolve um token novo; o antigo é revogado).
    const change = await http().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: TEMP, newPassword: DEFINITIVA }).expect(200);
    const fresh = change.body.accessToken as string;
    assert.ok(fresh);
    await http().get('/api/students/me').set(auth(token)).expect(401);
    await http().get('/api/students/me').set(auth(fresh)).expect(200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: e } })).mustChangePassword, false);
    const again = await login(e, DEFINITIVA);
    assert.equal(again.user.mustChangePassword, false);
  });

  it('senha atual errada na troca obrigatória: 400 e a flag continua ligada (nada destrava)', async () => {
    const { email: e } = await studentWithAccount();
    const token = (await login(e, TEMP)).accessToken;
    await http().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: 'errada-errada-1', newPassword: DEFINITIVA }).expect(400);
    await http().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: TEMP, newPassword: 'curta' }).expect(400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: e } })).mustChangePassword, true);
    assert.equal((await http().get('/api/students/me').set(auth(token)).expect(403)).body.code, CODE);
  });

  it('a flag vale a partir do BANCO: um token emitido ANTES de ligar a flag também é barrado, e desligar libera na hora', async () => {
    const { email: e } = await studentWithAccount();
    await prisma.user.update({ where: { email: e }, data: { mustChangePassword: false } });
    const token = (await login(e, TEMP)).accessToken;
    await http().get('/api/students/me').set(auth(token)).expect(200);

    await prisma.user.update({ where: { email: e }, data: { mustChangePassword: true } });
    assert.equal((await http().get('/api/students/me').set(auth(token)).expect(403)).body.code, CODE);

    await prisma.user.update({ where: { email: e }, data: { mustChangePassword: false } });
    await http().get('/api/students/me').set(auth(token)).expect(200);
  });

  it('vale para a equipe: professor com senha redefinida pelo Mestre fica barrado no painel até trocar a senha', async () => {
    const e = email('prof');
    const teacher = await http()
      .post('/api/teachers')
      .set(auth(mestre.token))
      .send({ name: '[e2e-mcp] Professor', email: e, password: TEMP, role: OrgRole.PROFESSOR })
      .expect(201);
    // Cadastro direto pelo Mestre não liga a flag (comportamento existente): usa o painel normalmente.
    const before = (await login(e, TEMP)).accessToken;
    await http().get('/api/students').set(auth(before)).expect(200);

    await http().post(`/api/teachers/${teacher.body.id}/reset-password`).set(auth(mestre.token)).send({ newPassword: 'Reset@Senha2026k' }).expect(204);
    const session = await login(e, 'Reset@Senha2026k');
    assert.equal(session.user.mustChangePassword, true);
    const t = session.accessToken;
    for (const path of ['/api/students', '/api/classes', '/api/lessons', '/api/announcements']) {
      const res = await http().get(path).set(auth(t)).expect(403);
      assert.equal(res.body.code, CODE, path);
    }
    await http().get('/api/auth/me').set(auth(t)).expect(200);
    const change = await http().post('/api/auth/change-password').set(auth(t)).send({ currentPassword: 'Reset@Senha2026k', newPassword: DEFINITIVA }).expect(200);
    await http().get('/api/students').set(auth(change.body.accessToken)).expect(200);
  });

  it('vale para a equipe GingApp (PLATFORM): platform-login devolve a flag e o admin fica barrado até trocar', async () => {
    const user = await createPlatformUser(prisma, 'mcp', { isSuperAdmin: true });
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true, name: 'E2E Team mcp' } });
    const res = await http().post('/api/auth/platform-login').send({ email: user.email, password: TEAM_PASSWORD }).expect(200);
    assert.equal(res.body.user.mustChangePassword, true);
    const token = res.body.accessToken as string;
    for (const path of ['/api/platform-dashboard', '/api/organizations', '/api/plans', '/api/platform-team']) {
      const r = await http().get(path).set(auth(token)).expect(403);
      assert.equal(r.body.code, CODE, path);
    }
    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(me.body.mustChangePassword, true);
    assert.equal(me.body.organizationId, undefined);
    const change = await http().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: TEAM_PASSWORD, newPassword: DEFINITIVA }).expect(200);
    await http().get('/api/platform-dashboard').set(auth(change.body.accessToken)).expect(200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword, false);
  });

  it('usuários normais (Mestre do seed) não são afetados e a flag nunca vem ligada no seed', async () => {
    const res = await http().get('/api/students').set(auth(mestre.token)).expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: MESTRE_EMAIL } })).mustChangePassword, false);
    // um token de PLATFORM comum (flag desligada) também passa
    const plain = await createPlatformUser(prisma, 'mcp', { isSuperAdmin: true });
    await prisma.user.update({ where: { id: plain.id }, data: { name: 'E2E Team mcp' } });
    const t = await platformLogin(app, plain.email);
    await http().get('/api/platform-dashboard').set(auth(t)).expect(200);
  });
});
