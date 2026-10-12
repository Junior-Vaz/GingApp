import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { SecondOrg, createSecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Um usuário (mesmo e-mail/login) pode ser ALUNO em mais de um grupo: um Student por organização
 * (Student @@unique([organizationId, userId])), com isolamento multi-tenant total. Dois grupos PRÓPRIOS desta
 * suíte (não toca no ginga-brasil nem no demo). Fixtures "[e2e-multig] ..." / "@e2e-multig.local", removidas no after().
 */
const TEMP_PASSWORD = 'Prov@Senha2026x';
const DOMAIN = '@e2e-multig.local';

describe('mesmo usuário como aluno em dois grupos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let orgA: SecondOrg;
  let orgB: SecondOrg;
  let slugA: string;
  let slugB: string;
  const stamp = Date.now();
  const sharedEmail = `compartilhado-${stamp}${DOMAIN}`;
  let studentA: { id: number };
  let studentB: { id: number };
  let tokenA: string;
  let tokenB: string;
  let sharedUserId: number;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = (emailAddr: string, organizationSlug?: string) =>
    http().post('/api/auth/login').send({ email: emailAddr, password: TEMP_PASSWORD, organizationSlug });
  async function newStudent(token: string, label: string): Promise<{ id: number }> {
    return (await http().post('/api/students').set(auth(token)).send({ name: `[e2e-multig] ${label}` }).expect(201)).body;
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    orgA = await createSecondOrg(app, prisma, 'multig-a');
    orgB = await createSecondOrg(app, prisma, 'multig-b');
    slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: orgA.organizationId } })).slug;
    slugB = (await prisma.organization.findUniqueOrThrow({ where: { id: orgB.organizationId } })).slug;
    studentA = await newStudent(orgA.token, 'Aluno do grupo A');
    studentB = await newStudent(orgB.token, 'Aluno do grupo B');
  });

  after(async () => {
    const rodas = await prisma.roda.findMany({ where: { title: { startsWith: '[e2e-multig]' } }, select: { id: true } });
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: rodas.map((r) => r.id) } } });
    await prisma.roda.deleteMany({ where: { id: { in: rodas.map((r) => r.id) } } });
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-multig]' } }, select: { id: true } });
    const ids = students.map((s) => s.id);
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.student.deleteMany({ where: { id: { in: ids } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: [orgA.organizationId, orgB.organizationId] } }, { userId: { in: userIds } }] } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgA.cleanup();
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('o mesmo e-mail vira aluno nos dois grupos: User único, um Student e um vínculo ALUNO por grupo', async () => {
    const first = await http()
      .post(`/api/students/${studentA.id}/account`)
      .set(auth(orgA.token))
      .send({ email: sharedEmail, password: TEMP_PASSWORD })
      .expect(201);
    assert.equal(first.body.linkedExistingUser, false);
    sharedUserId = first.body.account.userId;
    // Senha provisória => troca obrigatória no primeiro acesso (gate de 403); aqui o foco é o isolamento por grupo.
    await prisma.user.update({ where: { id: sharedUserId }, data: { mustChangePassword: false } });

    const second = await http().post(`/api/students/${studentB.id}/account`).set(auth(orgB.token)).send({ email: sharedEmail }).expect(201);
    assert.equal(second.body.linkedExistingUser, true, 'o segundo grupo apenas vincula o usuário existente');
    assert.equal(second.body.account.userId, sharedUserId);

    // Conferência independente no banco.
    assert.equal(await prisma.user.count({ where: { email: sharedEmail } }), 1);
    const students = await prisma.student.findMany({ where: { userId: sharedUserId }, orderBy: { id: 'asc' } });
    assert.deepEqual(
      students.map((s) => [s.id, s.organizationId]),
      [
        [studentA.id, orgA.organizationId],
        [studentB.id, orgB.organizationId],
      ],
    );
    const memberships = await prisma.organizationUser.findMany({ where: { userId: sharedUserId }, orderBy: { organizationId: 'asc' } });
    assert.equal(memberships.length, 2);
    assert.ok(memberships.every((m) => m.role === 'ALUNO' && m.status === 'ACTIVE'));
  });

  it('login: com 2 vínculos exige organizationSlug; com o slug de cada grupo entra naquele grupo', async () => {
    await login(sharedEmail).expect(400);
    await login(sharedEmail, 'slug-que-nao-existe').expect(401);

    const a = await login(sharedEmail, slugA).expect(200);
    const b = await login(sharedEmail, slugB).expect(200);
    assert.equal(a.body.user.organizationId, orgA.organizationId);
    assert.equal(b.body.user.organizationId, orgB.organizationId);
    assert.equal(a.body.user.role, 'ALUNO');
    tokenA = a.body.accessToken;
    tokenB = b.body.accessToken;
  });

  it('GET /students/me: cada grupo enxerga só o SEU Student do mesmo usuário', async () => {
    const meA = await http().get('/api/students/me').set(auth(tokenA)).expect(200);
    const meB = await http().get('/api/students/me').set(auth(tokenB)).expect(200);
    assert.deepEqual(meA.body.map((s: { id: number }) => s.id), [studentA.id]);
    assert.deepEqual(meB.body.map((s: { id: number }) => s.id), [studentB.id]);
    assert.ok(meA.body.every((s: { organizationId: number }) => s.organizationId === orgA.organizationId));
    assert.ok(meB.body.every((s: { organizationId: number }) => s.organizationId === orgB.organizationId));
  });

  it('isolamento: o token de um grupo não enxerga, lista nem altera o aluno do outro', async () => {
    const listA = await http().get('/api/students').set(auth(orgA.token)).expect(200);
    const idsA = (listA.body.items ?? listA.body).map((s: { id: number }) => s.id);
    assert.ok(idsA.includes(studentA.id));
    assert.ok(!idsA.includes(studentB.id), 'lista do grupo A não traz o aluno do grupo B');
    const listB = await http().get('/api/students').set(auth(orgB.token)).expect(200);
    const idsB = (listB.body.items ?? listB.body).map((s: { id: number }) => s.id);
    assert.ok(idsB.includes(studentB.id));
    assert.ok(!idsB.includes(studentA.id));

    await http().get(`/api/students/${studentB.id}`).set(auth(orgA.token)).expect(404);
    await http().get(`/api/students/${studentA.id}`).set(auth(orgB.token)).expect(404);
    await http().get(`/api/students/${studentB.id}/account`).set(auth(orgA.token)).expect(404);
    await http().post(`/api/students/${studentB.id}/account`).set(auth(orgA.token)).send({ email: `outro-${stamp}${DOMAIN}`, password: TEMP_PASSWORD }).expect(404);
    await http().delete(`/api/students/${studentB.id}`).set(auth(orgA.token)).expect(404);
    // O aluno logado num grupo não vê o Student do outro nem por id.
    await http().get(`/api/students/${studentB.id}`).set(auth(tokenA)).expect(403);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: studentB.id } })).status, 'ACTIVE');
  });

  it('Passaporte: a contagem de rodas por usuário não soma rodas de outro grupo', async () => {
    const date = new Date('2026-06-01T15:00:00Z');
    const rodaA = await prisma.roda.create({ data: { organizationId: orgA.organizationId, title: '[e2e-multig] Roda A', date } });
    const rodaB = await prisma.roda.create({ data: { organizationId: orgB.organizationId, title: '[e2e-multig] Roda B', date } });
    await prisma.rodaParticipant.createMany({
      data: [
        { rodaId: rodaA.id, userId: sharedUserId },
        { rodaId: rodaB.id, userId: sharedUserId },
      ],
    });
    const passA = await http().get('/api/passport/me').set(auth(tokenA)).expect(200);
    const passB = await http().get('/api/passport/me').set(auth(tokenB)).expect(200);
    assert.equal(passA.body.student.id, studentA.id);
    assert.equal(passB.body.student.id, studentB.id);
    assert.equal(passA.body.stats.rodas, 1, 'o grupo A só conta a roda do A');
    assert.equal(passB.body.stats.rodas, 1, 'o grupo B só conta a roda do B');
  });

  it('409 só dentro do MESMO grupo: outro aluno do grupo A não pode usar o login já ligado a um aluno do A', async () => {
    const another = await newStudent(orgA.token, 'Outro aluno do grupo A');
    const dup = await http().post(`/api/students/${another.id}/account`).set(auth(orgA.token)).send({ email: sharedEmail }).expect(409);
    assert.equal(dup.body.message, 'Este usuário já está vinculado a outro aluno.');
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: another.id } })).userId, null);
    // No banco a regra também vale (índice único por organização), independente da API.
    await assert.rejects(prisma.student.update({ where: { id: another.id }, data: { userId: sharedUserId } }));
  });

  it('reset de senha segue recusado (409) enquanto a conta é compartilhada com outro grupo', async () => {
    const res = await http()
      .post(`/api/students/${studentB.id}/reset-password`)
      .set(auth(orgB.token))
      .send({ newPassword: 'Nova@Senha2026y' })
      .expect(409);
    assert.match(res.body.message, /outro grupo/);
  });

  it('inativar o aluno de um grupo bloqueia só aquele vínculo: o outro grupo segue entrando', async () => {
    await http().delete(`/api/students/${studentA.id}`).set(auth(orgA.token)).expect(200);

    // Vínculo A bloqueado: sobra 1 vínculo utilizável e o login (política existente) o escolhe sozinho — nunca abre sessão no A.
    const viaA = await login(sharedEmail, slugA).expect(200);
    assert.equal(viaA.body.user.organizationId, orgB.organizationId, 'pedir o grupo A inativo não abre sessão no A');
    await http().get('/api/students/me').set(auth(tokenA)).expect(401); // token já emitido do grupo A cai
    await login(sharedEmail, slugB).expect(200);
    const meB = await http().get('/api/students/me').set(auth(tokenB)).expect(200);
    assert.deepEqual(meB.body.map((s: { id: number }) => s.id), [studentB.id]);
    // Só sobra 1 vínculo utilizável: o login sem slug escolhe o grupo B sozinho.
    const auto = await login(sharedEmail).expect(200);
    assert.equal(auto.body.user.organizationId, orgB.organizationId);

    // Reativar devolve o acesso ao grupo A.
    await http().patch(`/api/students/${studentA.id}`).set(auth(orgA.token)).send({ status: 'ACTIVE' }).expect(200);
    await login(sharedEmail, slugA).expect(200);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: studentB.id } })).status, 'ACTIVE');
  });
});
