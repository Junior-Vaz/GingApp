import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Envio rápido de avisos: POST /notifications/send e GET /notifications/audiences. Grupo PRÓPRIO (não toca seed/demo);
 * fixtures "@e2e-qsend.local"; tudo limpo no after().
 */
const DOMAIN = '@e2e-qsend.local';

describe('Envio rápido de avisos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  const stamp = Date.now();
  const tag = (n: string) => `[e2e-qsend] ${n} ${stamp}`;

  let monitor: { userId: number; token: string };
  let restrito: { userId: number; token: string }; // PROFESSOR com acesso só à unidade A
  let uA: { userId: number; token: string; studentId: number }; // aluno da unidade A (login)
  let gA: { userId: number; token: string }; // responsável do aluno A
  let uB: { userId: number; studentId: number }; // aluno da unidade B (login)
  let uInativo: { userId: number; studentId: number }; // aluno da turma A com vínculo INACTIVE
  let s3: number; // aluno da unidade A sem login
  let classA: number;
  let classB: number;
  let classEmpty: number;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const send = (token: string, body: Record<string, unknown>) => http().post('/api/notifications/send').set(auth(token)).send(body);
  const recipientsOf = async (title: string) =>
    (await prisma.notification.findMany({ where: { title, organizationId: org.organizationId }, select: { userId: true, type: true } }));

  async function makeUser(kind: string, role: OrgRole, status = 'ACTIVE') {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-qsend] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status } });
    return { userId: user.id, token: status === 'ACTIVE' ? (await loginAs(app, email)).token : '' };
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'qsend');
    orgB = await createSecondOrg(app, prisma, 'qsend');
    const organizationId = org.organizationId;

    monitor = await makeUser('monitor', OrgRole.MONITOR);
    restrito = org.professor;
    await prisma.userUnitAccess.create({ data: { organizationId, userId: restrito.userId, unitId: org.unitA.id } });
    const a = await makeUser('alunoA', OrgRole.ALUNO);
    gA = await makeUser('respA', OrgRole.RESPONSAVEL);
    const b = await makeUser('alunoB', OrgRole.ALUNO);
    const inativo = await makeUser('alunoInativo', OrgRole.ALUNO, 'INACTIVE');

    const sA = await prisma.student.create({ data: { organizationId, userId: a.userId, unitId: org.unitA.id, name: 'Aluno A' } });
    const sB = await prisma.student.create({ data: { organizationId, userId: b.userId, unitId: org.unitB.id, name: 'Aluno B' } });
    const sI = await prisma.student.create({ data: { organizationId, userId: inativo.userId, unitId: org.unitA.id, name: 'Aluno Inativo' } });
    s3 = (await prisma.student.create({ data: { organizationId, unitId: org.unitA.id, name: 'Aluno Sem Login' } })).id;
    uA = { ...a, studentId: sA.id };
    uB = { userId: b.userId, studentId: sB.id };
    uInativo = { userId: inativo.userId, studentId: sI.id };
    await prisma.studentGuardian.create({ data: { organizationId, studentId: sA.id, userId: gA.userId, name: 'Resp A' } });

    classA = (await prisma.class.create({ data: { organizationId, unitId: org.unitA.id, name: 'Turma A', autoGenerateLessons: false } })).id;
    classB = (await prisma.class.create({ data: { organizationId, unitId: org.unitB.id, name: 'Turma B', autoGenerateLessons: false } })).id;
    classEmpty = (await prisma.class.create({ data: { organizationId, unitId: org.unitA.id, name: 'Turma Vazia', autoGenerateLessons: false } })).id;
    for (const [classId, studentId] of [[classA, sA.id], [classA, s3], [classA, sI.id], [classB, sB.id]]) {
      await prisma.classStudent.create({ data: { organizationId, classId, studentId, status: 'ACTIVE' } });
    }
  });

  after(async () => {
    await prisma.announcement.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.notification.deleteMany({ where: { organizationId: orgB.organizationId } });
    await orgB.cleanup();
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GROUP: uma notificação ANNOUNCEMENT_QUICK por membro ATIVO do grupo; inativo e outro grupo nunca recebem; não cria comunicado', async () => {
    const title = tag('grupo');
    const res = await send(org.mestre.token, { title, body: 'Aviso a todos', audience: { scope: 'GROUP' } }).expect(201);
    const activeMembers = await prisma.organizationUser.findMany({ where: { organizationId: org.organizationId, status: 'ACTIVE' }, select: { userId: true } });
    assert.equal(res.body.sent, activeMembers.length);
    assert.equal(res.body.announcementId, null);
    const rows = await recipientsOf(title);
    assert.equal(rows.length, activeMembers.length);
    assert.equal(new Set(rows.map((r) => r.userId)).size, rows.length, 'uma por destinatário');
    assert.ok(rows.every((r) => r.type === 'ANNOUNCEMENT_QUICK'));
    assert.ok(!rows.some((r) => r.userId === uInativo.userId), 'vínculo INACTIVE não recebe');
    assert.equal(await prisma.notification.count({ where: { title, organizationId: orgB.organizationId } }), 0);
    assert.equal(await prisma.announcement.count({ where: { organizationId: org.organizationId, title } }), 0);
  });

  it('CLASS: alunos da turma e responsáveis (sem inativo, sem login); outro grupo/turma inexistente => 400', async () => {
    const title = tag('turma');
    const res = await send(org.mestre.token, { title, body: 'Aviso da turma', audience: { scope: 'CLASS', classId: classA } }).expect(201);
    assert.deepEqual((await recipientsOf(title)).map((r) => r.userId).sort(), [uA.userId, gA.userId].sort());
    assert.equal(res.body.sent, 2);
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'CLASS', classId: 999999999 } }).expect(400);
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'CLASS' } }).expect(400);
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'UNIT', unitId: 999999999 } }).expect(400);
  });

  it('STUDENTS: aluno escolhido + responsáveis; aluno de outro grupo 400; vazio/201+ 400; alsoPublish não vale', async () => {
    const title = tag('alunos');
    const res = await send(org.mestre.token, { title, body: 'Aviso aos alunos', audience: { scope: 'STUDENTS', studentIds: [uA.studentId, uB.studentId, s3] } }).expect(201);
    assert.deepEqual((await recipientsOf(title)).map((r) => r.userId).sort(), [uA.userId, gA.userId, uB.userId].sort());
    assert.equal(res.body.sent, 3);
    const foreign = await prisma.student.findFirstOrThrow({ where: { organizationId: { not: org.organizationId } }, select: { id: true } });
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'STUDENTS', studentIds: [uA.studentId, foreign.id] } }).expect(400);
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'STUDENTS', studentIds: [] } }).expect(400);
    await send(org.mestre.token, { title, body: 'x1', audience: { scope: 'STUDENTS', studentIds: Array.from({ length: 201 }, (_, i) => i + 1) } }).expect(400);
    await send(org.mestre.token, { title, body: 'x1', alsoPublish: true, audience: { scope: 'STUDENTS', studentIds: [uA.studentId] } }).expect(400);
  });

  it('ROLE e UNIT: filtram por papel/unidade', async () => {
    const roleTitle = tag('papel');
    await send(org.mestre.token, { title: roleTitle, body: 'Aos pais', audience: { scope: 'ROLE', audienceRole: 'RESPONSAVEL' } }).expect(201);
    assert.deepEqual((await recipientsOf(roleTitle)).map((r) => r.userId), [gA.userId]);

    const unitTitle = tag('unidade');
    await send(org.mestre.token, { title: unitTitle, body: 'Unidade B', audience: { scope: 'UNIT', unitId: org.unitB.id } }).expect(201);
    const ids = (await recipientsOf(unitTitle)).map((r) => r.userId);
    assert.ok(ids.includes(uB.userId) && ids.includes(org.mestre.userId));
    assert.ok(!ids.includes(uA.userId) && !ids.includes(gA.userId));
  });

  it('alsoPublish: cria 1 comunicado com o mesmo alcance e UMA notificação por destinatário (sem duplicar)', async () => {
    const title = tag('publicar');
    const res = await send(org.mestre.token, { title, body: 'No mural também', alsoPublish: true, audience: { scope: 'CLASS', classId: classA } }).expect(201);
    assert.equal(res.body.sent, 2);
    assert.ok(Number.isInteger(res.body.announcementId));
    const announcements = await prisma.announcement.findMany({ where: { organizationId: org.organizationId, title } });
    assert.equal(announcements.length, 1);
    assert.equal(announcements[0].id, res.body.announcementId);
    assert.equal(announcements[0].classId, classA);
    const rows = await recipientsOf(title);
    assert.equal(rows.length, 2, 'sem notificação em dobro');
    assert.ok(rows.every((r) => r.type === 'ANNOUNCEMENT'));
    // o aluno da turma enxerga o comunicado no mural
    await http().get(`/api/announcements/${res.body.announcementId}`).set(auth(uA.token)).expect(200);
  });

  it('0 destinatários => 400 NO_RECIPIENTS (e nenhum comunicado é criado)', async () => {
    const title = tag('vazio');
    for (const audience of [{ scope: 'CLASS', classId: classEmpty }, { scope: 'ROLE', audienceRole: 'INSTRUTOR' }]) {
      const res = await send(org.mestre.token, { title, body: 'Ninguém', alsoPublish: true, audience }).expect(400);
      assert.equal(res.body.code, 'NO_RECIPIENTS');
      assert.ok(typeof res.body.message === 'string' && res.body.message.length > 5);
    }
    assert.equal(await prisma.announcement.count({ where: { organizationId: org.organizationId, title } }), 0);
    assert.equal(await prisma.notification.count({ where: { title } }), 0);
  });

  it('permissão: MONITOR, ALUNO e RESPONSAVEL => 403 (envio e opções); sem token 401', async () => {
    const body = { title: tag('rbac'), body: 'Sem permissão', audience: { scope: 'GROUP' } };
    for (const token of [monitor.token, org.aluno.token, gA.token]) {
      await send(token, body).expect(403);
      await http().get('/api/notifications/audiences').set(auth(token)).expect(403);
    }
    await http().post('/api/notifications/send').send(body).expect(401);
    assert.equal(await prisma.notification.count({ where: { title: body.title } }), 0);
  });

  it('escopo de unidade: professor restrito (unidade A) => 403 para grupo, unidade B, turma B e aluno da B; unidade/turma A ok', async () => {
    const body = (audience: Record<string, unknown>) => ({ title: tag('escopo'), body: 'Escopo', audience });
    await send(restrito.token, body({ scope: 'GROUP' })).expect(403);
    await send(restrito.token, body({ scope: 'UNIT', unitId: org.unitB.id })).expect(403);
    await send(restrito.token, body({ scope: 'CLASS', classId: classB })).expect(403);
    await send(restrito.token, body({ scope: 'STUDENTS', studentIds: [uB.studentId] })).expect(403);
    await send(restrito.token, { ...body({ scope: 'CLASS', classId: classA }), alsoPublish: true }).expect(201);
    await send(restrito.token, body({ scope: 'UNIT', unitId: org.unitA.id })).expect(201);
    await send(restrito.token, body({ scope: 'ROLE', audienceRole: 'RESPONSAVEL' })).expect(201); // assume a única unidade dele

    const restrictedOptions = (await http().get('/api/notifications/audiences').set(auth(restrito.token)).expect(200)).body;
    assert.equal(restrictedOptions.groupWide, false);
    assert.deepEqual(restrictedOptions.units.map((u: { id: number }) => u.id), [org.unitA.id]);
    assert.ok(restrictedOptions.classes.every((c: { unitId: number | null }) => c.unitId === org.unitA.id || c.unitId === null));
    assert.ok(!restrictedOptions.classes.some((c: { id: number }) => c.id === classB));

    const mestreOptions = (await http().get('/api/notifications/audiences').set(auth(org.mestre.token)).expect(200)).body;
    assert.equal(mestreOptions.groupWide, true);
    assert.deepEqual(mestreOptions.units.map((u: { id: number }) => u.id).sort(), [org.unitA.id, org.unitB.id].sort());
    assert.ok(mestreOptions.classes.some((c: { id: number }) => c.id === classB));
    assert.ok(mestreOptions.roles.some((r: { value: string; label: string }) => r.value === 'ALUNO' && r.label));
  });

  it('isolamento: o MESTRE de outro grupo só alcança o próprio grupo e não usa ids do nosso (400)', async () => {
    const title = tag('isolamento');
    const res = await send(orgB.token, { title, body: 'Só do grupo B', audience: { scope: 'GROUP' } }).expect(201);
    assert.equal(res.body.sent, 1);
    assert.equal(await prisma.notification.count({ where: { title, organizationId: org.organizationId } }), 0);
    await send(orgB.token, { title, body: 'x1', audience: { scope: 'CLASS', classId: classA } }).expect(400);
    await send(orgB.token, { title, body: 'x1', audience: { scope: 'UNIT', unitId: org.unitA.id } }).expect(400);
    await send(orgB.token, { title, body: 'x1', audience: { scope: 'STUDENTS', studentIds: [uA.studentId] } }).expect(400);
  });

  it('validação do corpo e auditoria (contagem, nunca o texto)', async () => {
    const audience = { scope: 'GROUP' };
    await send(org.mestre.token, { title: 'a', body: 'texto ok', audience }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'b'.repeat(281), audience }).expect(400);
    await send(org.mestre.token, { title: 'x'.repeat(81), body: 'texto ok', audience }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'texto ok', audience: { scope: 'TODOS' } }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'texto ok', audience: { scope: 'ROLE', audienceRole: 'FULANO' } }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'texto ok', audience: { scope: 'UNIT' } }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'texto ok', audience, extra: 1 }).expect(400);
    await send(org.mestre.token, { title: 'Título', body: 'texto ok' }).expect(400);

    const secret = tag('auditoria');
    const res = await send(org.mestre.token, { title: secret, body: 'corpo-secreto-qsend', audience: { scope: 'CLASS', classId: classA } }).expect(201);
    const logs = await prisma.auditLog.findMany({ where: { organizationId: org.organizationId, action: 'NOTIFICATION_SEND' }, orderBy: { id: 'desc' }, take: 1 });
    assert.equal(logs.length, 1);
    const meta = logs[0].metadata as Record<string, unknown>;
    assert.equal(meta.sent, res.body.sent);
    assert.equal(meta.scope, 'CLASS');
    assert.ok(!JSON.stringify(logs[0]).includes('corpo-secreto-qsend') && !JSON.stringify(logs[0]).includes(secret), 'texto do aviso não vai para a auditoria');
  });
});
