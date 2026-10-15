import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MAX_REACTIVATE_LESSONS } from '../src/interface/http/lessons/lessons.service';
import { DEV_PASSWORD, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * POST /lessons/reactivate: reativa em massa as aulas CANCELADAS de um periodo (e turma). Grupos PROPRIOS (nunca o
 * seed/demo): periodo, turma, escopo de unidade, limite de 500, 403 sem lessons:edit, isolamento entre grupos, auditoria
 * (so a contagem) e notificacao opt-in (notify=true; padrao silencioso).
 */
const DOMAIN = '@e2e-reactivate.local';

describe('Reativar aulas canceladas em massa: POST /lessons/reactivate (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let other: ReportOrg;
  const stamp = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const day = (offset: number) => new Date(`${todaySaoPaulo(offset)}T00:00:00.000Z`);
  const iso = (offset: number) => todaySaoPaulo(offset);

  let classA: number;
  let classB: number; // unidade B
  let otherClass: number;
  let studentUserId: number;
  let instrutor: { userId: number; token: string };
  let monitor: { userId: number; token: string };
  const lessonIds: Record<string, number> = {};

  async function makeStaff(o: ReportOrg, kind: string, role: OrgRole) {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-react] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: o.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token };
  }

  const lesson = async (key: string, organizationId: number, classId: number, offset: number, status: 'ACTIVE' | 'INACTIVE' = 'INACTIVE') => {
    lessonIds[key] = (
      await prisma.lesson.create({
        data: { organizationId, classId, date: day(offset), status, cancelledAt: status === 'INACTIVE' ? new Date() : null, startTime: '20:30', endTime: '21:30' },
      })
    ).id;
  };
  const statusOf = async (key: string) => (await prisma.lesson.findUniqueOrThrow({ where: { id: lessonIds[key] } })).status;
  const reactivate = (token: string, body: Record<string, unknown>) => http().post('/api/lessons/reactivate').set(auth(token)).send(body);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'react');
    other = await createReportOrg(app, prisma, 'react-other');
    instrutor = await makeStaff(org, 'instrutor', OrgRole.INSTRUTOR);
    monitor = await makeStaff(org, 'monitor', OrgRole.MONITOR);
    studentUserId = org.aluno.userId;
    const organizationId = org.organizationId;
    classA = (await prisma.class.create({ data: { organizationId, name: 'Turma A', unitId: org.unitA.id, weekday: 3, autoGenerateLessons: false } })).id;
    classB = (await prisma.class.create({ data: { organizationId, name: 'Turma B', unitId: org.unitB.id, autoGenerateLessons: false } })).id;
    otherClass = (await prisma.class.create({ data: { organizationId: other.organizationId, name: 'Turma de outro grupo', autoGenerateLessons: false } })).id;
    const student = await prisma.student.create({ data: { organizationId, name: '[e2e-react] aluno' } });
    await prisma.classStudent.create({ data: { organizationId, classId: classA, studentId: student.id } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId } });
    // O aluno logavel (ALUNO) precisa estar ligado a um Student para receber a notificacao.
    await prisma.student.update({ where: { id: student.id }, data: { userId: studentUserId } });
  });

  after(async () => {
    await prisma.notification.deleteMany({ where: { organizationId: org.organizationId } });
    await org.cleanup();
    await other.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seed() {
    await prisma.lesson.deleteMany({ where: { organizationId: { in: [org.organizationId, other.organizationId] } } });
    const o = org.organizationId;
    await lesson('aPast', o, classA, -10); // fora do periodo
    await lesson('aIn1', o, classA, 1);
    await lesson('aIn2', o, classA, 8);
    await lesson('aActive', o, classA, 2, 'ACTIVE'); // ativa: nao conta
    await lesson('bIn', o, classB, 3); // outra turma/unidade B
    await lesson('aFar', o, classA, 40); // fora do periodo
    await lesson('otherOrg', other.organizationId, otherClass, 1); // outro grupo
  }

  it('periodo + turma: reativa so as canceladas da turma no intervalo (ativa e outras turmas/periodos/grupos intactos), limpa cancelledAt e audita', async () => {
    await seed();
    const res = await reactivate(org.mestre.token, { classId: classA, from: iso(0), to: iso(30) }).expect(200);
    assert.deepEqual(res.body, { reactivated: 2 });
    assert.equal(await statusOf('aIn1'), 'ACTIVE');
    assert.equal(await statusOf('aIn2'), 'ACTIVE');
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: lessonIds.aIn1 } })).cancelledAt, null);
    for (const k of ['aPast', 'bIn', 'aFar', 'otherOrg']) assert.equal(await statusOf(k), 'INACTIVE', `${k} nao muda`);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.organizationId, action: 'LESSON_REACTIVATE_BULK' }, orderBy: { id: 'desc' } });
    assert.equal(audit.resource, 'lesson');
    assert.deepEqual(audit.metadata, { count: 2, classId: classA, from: iso(0), to: iso(30), notify: false });
  });

  it('sem classId: todas as turmas do periodo; `to` so com data vale o dia inteiro; repetir devolve 0 (idempotente)', async () => {
    await seed();
    const res = await reactivate(org.mestre.token, { from: iso(1), to: iso(8) }).expect(200);
    assert.deepEqual(res.body, { reactivated: 3 }); // aIn1 (+1), bIn (+3), aIn2 (+8: dia inteiro de `to`)
    assert.equal(await statusOf('otherOrg'), 'INACTIVE');
    assert.deepEqual((await reactivate(org.mestre.token, { from: iso(1), to: iso(8) }).expect(200)).body, { reactivated: 0 });
  });

  it('validacao: from/to obrigatorios e validos, to < from = 400, turma de outro grupo = 400', async () => {
    await reactivate(org.mestre.token, { to: iso(3) }).expect(400);
    await reactivate(org.mestre.token, { from: iso(3) }).expect(400);
    await reactivate(org.mestre.token, { from: 'ontem', to: iso(3) }).expect(400);
    await reactivate(org.mestre.token, { from: iso(5), to: iso(1) }).expect(400);
    await reactivate(org.mestre.token, { classId: otherClass, from: iso(0), to: iso(30) }).expect(400);
    await reactivate(org.mestre.token, { from: iso(0), to: iso(30), notify: 'sim' }).expect(400);
  });

  it('permissao: sem token 401; ALUNO e MONITOR (sem lessons:edit) 403; INSTRUTOR (lessons:edit) 200', async () => {
    await seed();
    await http().post('/api/lessons/reactivate').send({ from: iso(0), to: iso(30) }).expect(401);
    await reactivate(org.aluno.token, { from: iso(0), to: iso(30) }).expect(403);
    await reactivate(monitor.token, { from: iso(0), to: iso(30) }).expect(403);
    assert.equal(await statusOf('aIn1'), 'INACTIVE', '403 nao altera nada');
    const res = await reactivate(instrutor.token, { classId: classA, from: iso(0), to: iso(30) }).expect(200);
    assert.deepEqual(res.body, { reactivated: 2 });
  });

  it('escopo de unidade: PROFESSOR restrito a unidade A so reativa as aulas da A (a da unidade B nem entra na conta; turma B = 400)', async () => {
    await seed();
    await prisma.userUnitAccess.create({ data: { organizationId: org.organizationId, userId: org.professor.userId, unitId: org.unitA.id } });
    try {
      const res = await reactivate(org.professor.token, { from: iso(0), to: iso(30) }).expect(200);
      assert.deepEqual(res.body, { reactivated: 2 }); // aIn1 + aIn2; bIn (unidade B) fica
      assert.equal(await statusOf('bIn'), 'INACTIVE');
      await reactivate(org.professor.token, { classId: classB, from: iso(0), to: iso(30) }).expect(400);
    } finally {
      await prisma.userUnitAccess.deleteMany({ where: { organizationId: org.organizationId } });
    }
  });

  it(`limite: mais de ${MAX_REACTIVATE_LESSONS} canceladas no periodo = 400 e NADA muda; um periodo menor passa`, async () => {
    await prisma.lesson.deleteMany({ where: { organizationId: org.organizationId } });
    const organizationId = org.organizationId;
    const data = Array.from({ length: MAX_REACTIVATE_LESSONS + 1 }, (_, i) => ({
      organizationId,
      classId: classA,
      date: day(1 + (i % 300)), // dias 1..300 (o dia 1 tem 2 aulas)
      status: 'INACTIVE' as const,
      cancelledAt: new Date(),
    }));
    await prisma.lesson.createMany({ data });
    const res = await reactivate(org.mestre.token, { from: iso(0), to: iso(400) }).expect(400);
    assert.match(res.body.message, /500/);
    assert.equal(await prisma.lesson.count({ where: { organizationId, status: 'INACTIVE' } }), MAX_REACTIVATE_LESSONS + 1);
    const first = await reactivate(org.mestre.token, { from: iso(1), to: iso(1) }).expect(200);
    assert.equal(first.body.reactivated, 2);
    // Sobraram 499 canceladas (<= 500): o periodo inteiro agora cabe numa chamada.
    const all = await reactivate(org.mestre.token, { from: iso(0), to: iso(400) }).expect(200);
    assert.equal(all.body.reactivated, MAX_REACTIVATE_LESSONS - 1);
  });

  it('notificacao: padrao SILENCIOSO (nenhuma notificacao); notify=true avisa o aluno da turma com "Aula reativada" (so aulas de hoje em diante)', async () => {
    await seed();
    const count = () => prisma.notification.count({ where: { organizationId: org.organizationId, title: 'Aula reativada' } });
    assert.equal(await count(), 0);
    await reactivate(org.mestre.token, { classId: classA, from: iso(0), to: iso(30) }).expect(200);
    assert.equal(await count(), 0, 'sem notify nao ha spam');

    await seed();
    const res = await reactivate(org.mestre.token, { classId: classA, from: iso(-30), to: iso(30), notify: true }).expect(200);
    assert.deepEqual(res.body, { reactivated: 3 }); // aPast + aIn1 + aIn2
    assert.equal(await count(), 2, 'a aula passada nao notifica; as 2 futuras sim');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: org.organizationId, action: 'LESSON_REACTIVATE_BULK' }, orderBy: { id: 'desc' } });
    assert.equal((audit.metadata as { notify: boolean }).notify, true);
  });
});
