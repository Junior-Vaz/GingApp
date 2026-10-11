import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Inativar o aluno (DELETE /students/:id) bloqueia o vínculo ALUNO (login e tokens existentes), mas NÃO
 * derruba outros vínculos da mesma pessoa (responsável por aluno ativo; outro grupo). Reativar devolve o acesso.
 * Fixtures "[e2e-inact] ..." / "@e2e-inact.local", removidas no after().
 */
const PASS = 'Senha@Inativo2026a';
const DOMAIN = '@e2e-inact.local';

describe('aluno inativo não entra (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const stamp = Date.now();
  let seq = 0;

  async function makeStudentUser(orgId: number, role: OrgRole) {
    const email = `u${++seq}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(PASS, 4), name: `[e2e-inact] ${email}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    return user;
  }
  async function makeStudent(orgId: number, userId: number | null, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    return prisma.student.create({ data: { organizationId: orgId, userId, name: `[e2e-inact] Aluno ${++seq}`, status } });
  }
  const login = (email: string, slug?: string) => http().post('/api/auth/login').send({ email, password: PASS, organizationSlug: slug });

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    mestre = await loginAs(app, MESTRE_EMAIL);
    orgB = await createSecondOrg(app, prisma, 'inact');
  });

  after(async () => {
    const students = await prisma.student.findMany({ where: { name: { startsWith: '[e2e-inact]' } }, select: { id: true } });
    const ids = students.map((s) => s.id);
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: ids } } });
    await prisma.student.deleteMany({ where: { id: { in: ids } } });
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('DELETE /students/:id derruba login E token existente do aluno; reativar devolve o acesso', async () => {
    const user = await makeStudentUser(mestre.organizationId, OrgRole.ALUNO);
    const student = await makeStudent(mestre.organizationId, user.id);
    const session = await login(user.email).expect(200);
    const token = session.body.accessToken as string;
    await http().get('/api/students/me').set(auth(token)).expect(200);

    await http().delete(`/api/students/${student.id}`).set(auth(mestre.token)).expect(200);
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).status, 'INACTIVE');
    await http().get('/api/students/me').set(auth(token)).expect(401); // token que já existia
    await login(user.email).expect(401); // login novo (mensagem genérica)

    await http().patch(`/api/students/${student.id}`).set(auth(mestre.token)).send({ status: 'ACTIVE' }).expect(200);
    await login(user.email).expect(200);
    await http().get('/api/students/me').set(auth(token)).expect(200);
  });

  it('não derruba outros vínculos: responsável por aluno ativo e o mesmo usuário em outro grupo continuam entrando', async () => {
    // (a) ALUNO inativo no grupo A, mas responsável por um aluno ATIVO do mesmo grupo
    const both = await makeStudentUser(mestre.organizationId, OrgRole.ALUNO);
    const own = await makeStudent(mestre.organizationId, both.id, 'INACTIVE');
    const dependent = await makeStudent(mestre.organizationId, null);
    await prisma.studentGuardian.create({ data: { organizationId: mestre.organizationId, studentId: dependent.id, userId: both.id, name: 'Resp' } });
    const ok = await login(both.email).expect(200);
    await http().get('/api/students/me').set(auth(ok.body.accessToken)).expect(200);
    // sem dependente ativo ele cairia: inativa o dependente também
    await prisma.student.update({ where: { id: dependent.id }, data: { status: 'INACTIVE' } });
    await login(both.email).expect(401);
    await http().get('/api/students/me').set(auth(ok.body.accessToken)).expect(401);
    assert.equal(own.status, 'INACTIVE');

    // (b) ALUNO inativo no grupo A + RESPONSAVEL no grupo B: o login do grupo B segue valendo (sem precisar de slug)
    const multi = await makeStudentUser(mestre.organizationId, OrgRole.ALUNO);
    await makeStudent(mestre.organizationId, multi.id, 'INACTIVE');
    await prisma.organizationUser.create({ data: { organizationId: orgB.organizationId, userId: multi.id, role: OrgRole.RESPONSAVEL, status: 'ACTIVE' } });
    const viaB = await login(multi.email).expect(200);
    assert.equal(viaB.body.user.organizationId, orgB.organizationId);
    assert.equal(viaB.body.user.role, 'RESPONSAVEL');
    const orgASlug = (await prisma.organization.findUniqueOrThrow({ where: { id: mestre.organizationId } })).slug;
    // Mesmo pedindo o grupo A, o vínculo ALUNO de A está bloqueado: o único utilizável é o de B.
    const viaSlugA = await login(multi.email, orgASlug).expect(200);
    assert.equal(viaSlugA.body.user.organizationId, orgB.organizationId);
  });
});
