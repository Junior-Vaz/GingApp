import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { backfillStaffRoles } from '../src/interface/http/roles/staff-roles';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * FICHA UNICA - Fase 3: cargos acumulaveis (docs/FICHA_UNICA.md secao 5). Grupos PROPRIOS (A e B); nunca o seed/demo.
 * Fixtures "[e2e-cargos]" / "@e2e-cargos.local", limpas no after().
 */
const PREFIX = '[e2e-cargos]';
const DOMAIN = '@e2e-cargos.local';
const PASSWORD = 'Prov@Senha2026x';

describe('cargos acumulaveis - fase 3 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let A: ReportOrg;
  let B: ReportOrg;
  let slugA: string;
  const stamp = Date.now();
  let monitor: { studentId: number; userId: number; token: string };
  let systemId: number;
  const levels: number[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const newStudent = async (name: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} ${name}`, ...extra }).expect(201)).body as { id: number; personId: number };
  const login = async (email: string) =>
    (await http().post('/api/auth/login').send({ email, password: PASSWORD, organizationSlug: slugA }).expect(200)).body.accessToken as string;

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    A = await createReportOrg(app, prisma, 'cargos-a');
    B = await createReportOrg(app, prisma, 'cargos-b');
    slugA = (await prisma.organization.findUniqueOrThrow({ where: { id: A.organizationId } })).slug;
    const system = await prisma.graduationSystem.create({ data: { organizationId: A.organizationId, name: `${PREFIX} Sistema` } });
    systemId = system.id;
    for (const [order, name] of [[1, 'Crua'], [2, 'Verde'], [3, 'Amarela']] as const) {
      levels.push((await prisma.graduationLevel.create({ data: { organizationId: A.organizationId, graduationSystemId: system.id, name, order, color: '#00AA00', colors: ['#00AA00'] } })).id);
    }
  });

  after(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: [...userIds, A.mestre.userId, A.professor.userId] } } });
    await prisma.pointEvent.deleteMany({ where: { organizationId: { in: [A.organizationId, B.organizationId] } } });
    await A.cleanup();
    await B.cleanup();
    await prisma.person.deleteMany({ where: { name: { startsWith: PREFIX }, students: { none: {} } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('migracao/backfill: papel de equipe vira cargo + matricula de aluno (isStaff), sem mudar o acesso; idempotente', async () => {
    // Antes do backfill o papel legado ja aparece como cargo (sem materializar) e o acesso e o mesmo.
    const me = await http().get('/api/auth/me').set(auth(A.professor.token)).expect(200);
    assert.equal(me.body.role, 'PROFESSOR');
    assert.deepEqual(me.body.roles, ['PROFESSOR']);
    await http().get('/api/students').set(auth(A.professor.token)).expect(200);

    const first = await backfillStaffRoles(prisma, { organizationIds: [A.organizationId] });
    assert.equal(first.staffMemberships, 2);
    assert.equal(first.rolesCreated, 2);
    assert.equal(first.enrollmentsCreated, 2);
    const again = await backfillStaffRoles(prisma, { organizationIds: [A.organizationId] });
    assert.deepEqual([again.rolesCreated, again.enrollmentsCreated, again.enrollmentsReused], [0, 0, 2]);
    const staff = await prisma.student.findMany({ where: { organizationId: A.organizationId, isStaff: true }, select: { userId: true, personId: true, status: true } });
    assert.deepEqual(staff.map((s) => s.userId).sort(), [A.mestre.userId, A.professor.userId].sort());
    assert.ok(staff.every((s) => s.personId && s.status === 'ACTIVE'));
    const roles = await prisma.organizationUser.findMany({ where: { organizationId: A.organizationId }, select: { userId: true, role: true } });
    assert.equal(roles.find((r) => r.userId === A.mestre.userId)!.role, 'MESTRE', 'acesso intacto');
    assert.equal(roles.find((r) => r.userId === A.professor.userId)!.role, 'PROFESSOR');

    const team = await http().get('/api/teachers').set(auth(A.mestre.token)).expect(200);
    const mestre = (team.body.items ?? team.body).find((t: { user: { id: number } }) => t.user.id === A.mestre.userId);
    assert.deepEqual(mestre.roles, ['MESTRE']);
    assert.ok(mestre.student?.id, 'staff tambem e aluno: matricula ligada');
    // Ranking/Jornada funcionam para o staff como aluno (antes do backfill era 404 para quem nao tinha matricula).
    await http().get('/api/ranking/me').set(auth(A.mestre.token)).expect(200);
  });

  it('matricula da equipe (isStaff) nao ocupa vaga do plano', async () => {
    const active = await prisma.student.count({ where: { organizationId: A.organizationId, status: 'ACTIVE', isStaff: false } });
    const plan = await prisma.plan.create({ data: { name: 'Plano E2E cargos', code: `e2e-cargos-${stamp}`, maxStudents: active + 1 } });
    await prisma.subscription.create({ data: { organizationId: A.organizationId, planId: plan.id, status: 'ACTIVE' } });
    await newStudent('Vaga');
    await http().post('/api/students').set(auth(A.mestre.token)).send({ name: `${PREFIX} Sem vaga` }).expect(400);
    await prisma.subscription.deleteMany({ where: { organizationId: A.organizationId } });
  });

  it('conceder: so MESTRE; LOGIN_REQUIRED sem acesso; cria o login; o token existente ganha o cargo na hora', async () => {
    const s = await newStudent('Monitor Um');
    await http().post('/api/roles/grant').set(auth(A.professor.token)).send({ studentId: s.id, role: 'MONITOR' }).expect(403);
    await http().post('/api/roles/grant').set(auth(B.mestre.token)).send({ studentId: s.id, role: 'MONITOR' }).expect(404);
    const noLogin = await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, role: 'MONITOR' }).expect(400);
    assert.equal(noLogin.body.code, 'LOGIN_REQUIRED');
    const email = `monitor-${stamp}${DOMAIN}`;
    const res = await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, role: 'MONITOR', email, password: PASSWORD }).expect(201);
    assert.deepEqual(res.body.roles, ['MONITOR']);
    assert.equal(res.body.accessRole, 'MONITOR');
    const dup = await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: s.id, role: 'MONITOR' }).expect(409);
    assert.equal(dup.body.code, 'ROLE_ALREADY_ACTIVE');
    await prisma.user.update({ where: { id: res.body.userId }, data: { mustChangePassword: false } });
    monitor = { studentId: s.id, userId: res.body.userId, token: await login(email) };
    const me = await http().get('/api/auth/me').set(auth(monitor.token)).expect(200);
    assert.equal(me.body.role, 'MONITOR');
    assert.deepEqual(me.body.roles, ['MONITOR']);
    assert.equal(await prisma.notification.count({ where: { userId: monitor.userId, type: 'ROLE_GRANTED' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: A.organizationId, action: 'ROLE_GRANT' } }), 1);
  });

  it('matriz pelo MAIOR cargo: MONITOR le alunos/turmas e faz chamada, mas nao ve financeiro, equipe nem dashboard', async () => {
    await http().get('/api/students').set(auth(monitor.token)).expect(200);
    await http().get('/api/classes').set(auth(monitor.token)).expect(200);
    await http().get('/api/finance').set(auth(monitor.token)).expect(403);
    await http().get('/api/teachers').set(auth(monitor.token)).expect(403);
    await http().get('/api/dashboard').set(auth(monitor.token)).expect(403);
    await http().post('/api/students').set(auth(monitor.token)).send({ name: `${PREFIX} Nao pode` }).expect(403);
    const perms = await prisma.rolePermission.findUniqueOrThrow({ where: { role_resource: { role: 'MONITOR', resource: 'attendance' } } });
    assert.deepEqual([perms.canView, perms.canCreate, perms.canEdit, perms.canDelete], [true, true, true, false]);
  });

  it('INSTRUTOR: cadastra e edita, mas nunca exclui; sem financeiro; promocao acumula (maior cargo vira o acesso)', async () => {
    await http().post('/api/roles/grant').set(auth(A.mestre.token)).send({ studentId: monitor.studentId, role: 'INSTRUTOR' }).expect(201);
    const me = await http().get('/api/auth/me').set(auth(monitor.token)).expect(200);
    assert.equal(me.body.role, 'INSTRUTOR');
    assert.deepEqual(me.body.roles, ['INSTRUTOR', 'MONITOR']);
    const s = (await http().post('/api/students').set(auth(monitor.token)).send({ name: `${PREFIX} Pelo instrutor` }).expect(201)).body;
    await http().delete(`/api/students/${s.id}`).set(auth(monitor.token)).expect(403);
    await http().get('/api/finance').set(auth(monitor.token)).expect(403);
    const list = await http().get('/api/students?role=INSTRUTOR').set(auth(A.mestre.token)).expect(200);
    const items = list.body.items ?? list.body;
    assert.deepEqual(items.map((i: { id: number }) => i.id), [monitor.studentId]);
    assert.deepEqual(items[0].staffRoles, ['INSTRUTOR', 'MONITOR']);
    const ficha = await http().get(`/api/students/${monitor.studentId}/ficha`).set(auth(A.mestre.token)).expect(200);
    assert.deepEqual(ficha.body.enrollments[0].roles, ['INSTRUTOR', 'MONITOR']);
    assert.equal(ficha.body.roles.length, 2);
  });

  it('revogar: volta ao cargo restante (e a ALUNO sem cargo), a matricula continua; ultimo MESTRE nao sai', async () => {
    const r1 = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: monitor.studentId, role: 'INSTRUTOR' }).expect(200);
    assert.equal(r1.body.accessRole, 'MONITOR');
    const r2 = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: monitor.studentId, role: 'MONITOR' }).expect(200);
    assert.deepEqual(r2.body.roles, []);
    assert.equal(r2.body.accessRole, 'ALUNO');
    assert.equal((await prisma.student.findUniqueOrThrow({ where: { id: monitor.studentId } })).status, 'ACTIVE');
    await http().get('/api/students').set(auth(monitor.token)).expect(403);
    const again = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: monitor.studentId, role: 'MONITOR' }).expect(409);
    assert.equal(again.body.code, 'ROLE_NOT_ACTIVE');
    const mestreStudent = await prisma.student.findFirstOrThrow({ where: { organizationId: A.organizationId, userId: A.mestre.userId } });
    const last = await http().post('/api/roles/revoke').set(auth(A.mestre.token)).send({ studentId: mestreStudent.id, role: 'MESTRE' }).expect(409);
    assert.equal(last.body.code, 'LAST_MESTRE');
    assert.equal(await prisma.personRole.count({ where: { userId: monitor.userId, organizationId: A.organizationId } }), 2, 'historico preservado');
  });

  it('regras de corda e sugestoes: so MESTRE grava; aviso ao Mestre 1x por aluno+cargo; quem ja tem cargo maior nao e sugerido', async () => {
    await http().put(`/api/graduations/systems/${systemId}/role-rules`).set(auth(A.professor.token)).send({ rules: [{ role: 'MONITOR', minLevelOrder: 2 }] }).expect(403);
    const bad = await http().put(`/api/graduations/systems/${systemId}/role-rules`).set(auth(A.mestre.token)).send({ rules: [{ role: 'MONITOR', minLevelOrder: 9 }] }).expect(400);
    assert.equal(bad.body.code, 'INVALID_LEVEL_ORDER');
    const saved = await http().put(`/api/graduations/systems/${systemId}/role-rules`).set(auth(A.mestre.token)).send({ rules: [{ role: 'MONITOR', minLevelOrder: 2 }] }).expect(200);
    assert.deepEqual(saved.body.rules.map((r: { role: string; minLevelOrder: number; level: { name: string } }) => [r.role, r.minLevelOrder, r.level.name]), [['MONITOR', 2, 'Verde']]);
    await http().get(`/api/graduations/systems/${systemId}/role-rules`).set(auth(B.mestre.token)).expect(404);

    const kid = await newStudent('Graduado');
    await http().post(`/api/graduations/students/${kid.id}`).set(auth(A.mestre.token)).send({ graduationLevelId: levels[1], graduatedAt: '2026-09-01' }).expect(201);
    await http().post(`/api/graduations/students/${kid.id}`).set(auth(A.mestre.token)).send({ graduationLevelId: levels[2], graduatedAt: '2026-10-01' }).expect(201);
    const suggestions = await http().get('/api/roles/suggestions').set(auth(A.mestre.token)).expect(200);
    const mine = suggestions.body.filter((s: { studentId: number }) => s.studentId === kid.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].role, 'MONITOR');
    assert.equal(mine[0].level.name, 'Amarela');
    await http().get('/api/roles/suggestions').set(auth(A.professor.token)).expect(403);
    // Aviso em segundo plano: espera curta e confere que veio UMA vez (mesmo com duas graduacoes acima da regra).
    for (let i = 0; i < 20 && (await prisma.notification.count({ where: { userId: A.mestre.userId, type: 'ROLE_SUGGESTION' } })) === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(await prisma.notification.count({ where: { userId: A.mestre.userId, type: 'ROLE_SUGGESTION' } }), 1);
    // O professor (cargo maior) graduado nunca e sugerido para MONITOR.
    const profStudent = await prisma.student.findFirstOrThrow({ where: { organizationId: A.organizationId, userId: A.professor.userId } });
    await prisma.studentGraduation.create({ data: { organizationId: A.organizationId, studentId: profStudent.id, graduationLevelId: levels[2]!, graduatedAt: new Date() } });
    const after2 = await http().get('/api/roles/suggestions').set(auth(A.mestre.token)).expect(200);
    assert.ok(!after2.body.some((s: { studentId: number }) => s.studentId === profStudent.id));
  });

  it('tela Equipe: criar INSTRUTOR gera o cargo; isolamento entre grupos', async () => {
    const res = await http()
      .post('/api/teachers')
      .set(auth(A.mestre.token))
      .send({ name: `${PREFIX} Instrutor Equipe`, email: `instrutor-${stamp}${DOMAIN}`, password: PASSWORD, role: 'INSTRUTOR' })
      .expect(201);
    assert.equal(res.body.role, 'INSTRUTOR');
    const roles = await prisma.personRole.findMany({ where: { organizationId: A.organizationId, userId: res.body.user.id, revokedAt: null } });
    assert.deepEqual(roles.map((r) => r.role), ['INSTRUTOR']);
    const listB = await http().get('/api/teachers').set(auth(B.mestre.token)).expect(200);
    assert.ok(!(listB.body.items ?? listB.body).some((t: { user: { id: number } }) => t.user.id === res.body.user.id));
  });
});
