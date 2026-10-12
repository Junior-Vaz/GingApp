import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { ClassLessonsRollingService, lessonsHorizonDays } from '../src/interface/http/classes/class-lessons-rolling.service';
import { createSecondOrg, DEV_PASSWORD, loginAs, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Aulas continuas (sem data final): geracao rolante ate LESSONS_HORIZON_DAYS (padrao 60) a partir de hoje.
 * Tudo numa organizacao PROPRIA da suite (createSecondOrg) — o seed e o demo nunca sao tocados: ensureHorizon so' e'
 * chamado com { classId } de turma da suite ou { organizationId } da org da suite. O JOB agendado em si
 * (registro do @Cron, 01:30 SP, LESSONS_CRON=false) e' coberto por test/lessons-cron.spec.ts.
 */
const DAY = 86_400_000;

/** Datas "YYYY-MM-DD" de hoje (SP) ate hoje+N cujo dia da semana e' `weekday` — calculo independente do service. */
function expectedDates(weekday: number, horizon = 60, offsetDays = 0): string[] {
  const start = new Date(`${todaySaoPaulo(offsetDays)}T00:00:00.000Z`).getTime();
  const out: string[] = [];
  for (let t = start; t <= start + horizon * DAY; t += DAY) {
    if (new Date(t).getUTCDay() === weekday) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe('Aulas continuas: geracao rolante (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let orgB: SecondOrg;
  let rolling: ClassLessonsRollingService;
  let alunoUserId: number;
  let alunoStudentId: number;
  const extraUserIds: number[] = [];

  const lessonDates = async (classId: number, where: object = {}) =>
    (await prisma.lesson.findMany({ where: { classId, ...where }, orderBy: { date: 'asc' } })).map((l) => l.date.toISOString().slice(0, 10));

  /** O create/edit dispara a geracao em segundo plano (fire-and-forget): espera aparecer (ate 8 s). */
  async function waitForLessons(classId: number, atLeast = 1) {
    for (let i = 0; i < 80; i += 1) {
      if ((await prisma.lesson.count({ where: { classId } })) >= atLeast) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`a geracao em segundo plano da turma ${classId} nao aconteceu`);
  }

  const createClass = (body: Record<string, unknown>) =>
    request(server()).post('/api/classes').set(auth(orgB.token)).send({ name: '[e2e-cont] Turma', ...body });

  before(async () => {
    app = await createTestApp();
    rolling = app.get(ClassLessonsRollingService);
    orgB = await createSecondOrg(app, prisma, 'cont');
    const user = await prisma.user.create({
      data: { email: `aluno-cont-${Date.now()}@e2e-cont.local`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: 'Aluno Cont', userType: 'MEMBER', status: 'ACTIVE' },
    });
    extraUserIds.push(user.id);
    alunoUserId = user.id;
    await prisma.organizationUser.create({ data: { organizationId: orgB.organizationId, userId: user.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
    alunoStudentId = (await prisma.student.create({ data: { organizationId: orgB.organizationId, userId: user.id, name: 'Aluno Cont' } })).id;
  });

  after(async () => {
    const organizationId = orgB.organizationId;
    await prisma.notification.deleteMany({ where: { organizationId } });
    await prisma.lesson.deleteMany({ where: { organizationId } });
    await prisma.classStudent.deleteMany({ where: { organizationId } });
    await prisma.class.deleteMany({ where: { organizationId } });
    await prisma.student.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('padrao: autoGenerateLessons=true; LESSONS_HORIZON_DAYS = 60 (invalido volta ao padrao, teto 365)', () => {
    assert.equal(lessonsHorizonDays({}), 60);
    assert.equal(lessonsHorizonDays({ LESSONS_HORIZON_DAYS: '30' }), 30);
    assert.equal(lessonsHorizonDays({ LESSONS_HORIZON_DAYS: 'abc' }), 60);
    assert.equal(lessonsHorizonDays({ LESSONS_HORIZON_DAYS: '0' }), 60);
    assert.equal(lessonsHorizonDays({ LESSONS_HORIZON_DAYS: '9999' }), 365);
  });

  it('criar turma com dia da semana gera as aulas ate o horizonte (em segundo plano), copiando horario', async () => {
    const res = await createClass({ weekday: 2, startTime: '19:00', endTime: '20:30' }).expect(201);
    const classId: number = res.body.id;
    assert.equal(res.body.autoGenerateLessons, true);
    const expected = expectedDates(2);
    await waitForLessons(classId, expected.length);
    assert.deepEqual(await lessonDates(classId), expected);
    const lessons = await prisma.lesson.findMany({ where: { classId } });
    assert.ok(lessons.every((l) => l.startTime === '19:00' && l.endTime === '20:30' && l.status === 'ACTIVE'));
    assert.ok(expected.length >= 8 && expected.length <= 10, `60 dias tem 8 a 10 tercas (${expected.length})`);
  });

  it('ensureHorizon e IDEMPOTENTE e nunca recria aula CANCELADA', async () => {
    const classId = (await createClass({ weekday: 4 }).expect(201)).body.id as number;
    const expected = expectedDates(4);
    await waitForLessons(classId, expected.length);

    const again = await rolling.ensureHorizon({ classId });
    assert.equal(again.classes, 1);
    assert.equal(again.created, 0);
    assert.equal(await prisma.lesson.count({ where: { classId } }), expected.length);

    const first = await prisma.lesson.findFirstOrThrow({ where: { classId }, orderBy: { date: 'asc' } });
    await prisma.lesson.update({ where: { id: first.id }, data: { status: 'INACTIVE' } });
    const afterCancel = await rolling.ensureHorizon({ classId });
    assert.equal(afterCancel.created, 0);
    assert.equal((await prisma.lesson.findUniqueOrThrow({ where: { id: first.id } })).status, 'INACTIVE');
    assert.equal(await prisma.lesson.count({ where: { classId } }), expected.length);
  });

  it('o horizonte rola: 30 dias depois gera so as datas novas', async () => {
    const classId = (await createClass({ weekday: 5 }).expect(201)).body.id as number;
    await waitForLessons(classId, expectedDates(5).length);
    const later = await rolling.ensureHorizon({ classId }, new Date(Date.now() + 30 * DAY));
    const all = expectedDates(5, 90); // de hoje ate hoje+90: o que existe depois de rolar 30 dias (hoje+30+60)
    const upToHorizon = all.filter((d) => d <= todaySaoPaulo(90));
    assert.equal(later.created, upToHorizon.length - expectedDates(5).length);
    assert.deepEqual(await lessonDates(classId), upToHorizon);
  });

  it('POST /classes/:id/generate-lessons sem `to` liga o modo continuo e gera ate o horizonte', async () => {
    const classId = (await createClass({ weekday: 3, autoGenerateLessons: false }).expect(201)).body.id as number;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await prisma.lesson.count({ where: { classId } }), 0, 'autoGenerateLessons=false nao gera ao criar');
    assert.equal(
      (await rolling.ensureHorizon({ classId })).classes,
      0,
      'turma com autoGenerateLessons=false nao e elegivel',
    );

    const res = await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({}).expect(201);
    const expected = expectedDates(3);
    assert.equal(res.body.continuous, true);
    assert.equal(res.body.autoGenerateLessons, true);
    assert.equal(res.body.horizonDays, 60);
    assert.equal(res.body.created, expected.length);
    assert.deepEqual(await lessonDates(classId), expected);
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: classId } })).autoGenerateLessons, true);

    const repeat = await request(server())
      .post(`/api/classes/${classId}/generate-lessons`)
      .set(auth(orgB.token))
      .send({ continuous: true })
      .expect(201);
    assert.equal(repeat.body.created, 0);
    assert.equal(repeat.body.ignored, expected.length);
  });

  it('com from+to explicitos mantem o periodo manual (nao liga o continuo; 90 dias de teto); to+continuous => 400', async () => {
    const classId = (await createClass({ weekday: 1, autoGenerateLessons: false }).expect(201)).body.id as number;
    const from = todaySaoPaulo();
    const to = todaySaoPaulo(20);
    const res = await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({ from, to }).expect(201);
    assert.equal(res.body.continuous, false);
    assert.deepEqual(res.body.createdDates, expectedDates(1, 20));
    assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: classId } })).autoGenerateLessons, false);
    const tooLong = await request(server())
      .post(`/api/classes/${classId}/generate-lessons`)
      .set(auth(orgB.token))
      .send({ from, to: todaySaoPaulo(91) })
      .expect(400);
    assert.match(JSON.stringify(tooLong.body), /90 dias/);
    await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({ from, to, continuous: true }).expect(400);
    await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({ continuous: false }).expect(400);
  });

  it('gerar aulas nao notifica ninguem (aluno matriculado fica sem notificacao)', async () => {
    const classId = (await createClass({ weekday: 6, autoGenerateLessons: false }).expect(201)).body.id as number;
    await prisma.classStudent.create({ data: { organizationId: orgB.organizationId, classId, studentId: alunoStudentId } });
    const before = await prisma.notification.count({ where: { userId: alunoUserId } });
    await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({}).expect(201);
    assert.ok((await prisma.lesson.count({ where: { classId } })) > 0);
    assert.equal(await prisma.notification.count({ where: { userId: alunoUserId } }), before);
  });

  it('PATCH autoGenerateLessons liga/desliga; editar o dia de uma turma sem dia dispara a geracao; desligar nao apaga as aulas', async () => {
    const classId = (await createClass({}).expect(201)).body.id as number; // sem weekday
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await prisma.lesson.count({ where: { classId } }), 0);

    await request(server()).patch(`/api/classes/${classId}`).set(auth(orgB.token)).send({ autoGenerateLessons: 'sim' }).expect(400);
    await request(server()).patch(`/api/classes/${classId}`).set(auth(orgB.token)).send({ autoGenerateLessons: null }).expect(400);
    const res = await request(server()).patch(`/api/classes/${classId}`).set(auth(orgB.token)).send({ weekday: 0 }).expect(200);
    assert.equal(res.body.autoGenerateLessons, true);
    const expected = expectedDates(0);
    await waitForLessons(classId, expected.length);
    assert.deepEqual(await lessonDates(classId), expected);

    const off = await request(server()).patch(`/api/classes/${classId}`).set(auth(orgB.token)).send({ autoGenerateLessons: false }).expect(200);
    assert.equal(off.body.autoGenerateLessons, false);
    assert.equal((await rolling.ensureHorizon({ classId }, new Date(Date.now() + 40 * DAY))).created, 0);
    assert.equal(await prisma.lesson.count({ where: { classId } }), expected.length, 'nada apagado nem acrescentado');
  });

  it('turma INATIVA nao gera, mas as aulas futuras ja geradas continuam existindo', async () => {
    const classId = (await createClass({ weekday: 2 }).expect(201)).body.id as number;
    const expected = expectedDates(2);
    await waitForLessons(classId, expected.length);
    await request(server()).patch(`/api/classes/${classId}`).set(auth(orgB.token)).send({ status: 'INACTIVE' }).expect(200);
    const result = await rolling.ensureHorizon({ classId }, new Date(Date.now() + 40 * DAY));
    assert.equal(result.classes, 0);
    assert.equal(result.created, 0);
    assert.equal(await prisma.lesson.count({ where: { classId } }), expected.length);
    assert.equal(await prisma.lesson.count({ where: { classId, status: 'ACTIVE', date: { gte: new Date(`${todaySaoPaulo()}T00:00:00.000Z`) } } }), expected.length);
    await request(server()).post(`/api/classes/${classId}/generate-lessons`).set(auth(orgB.token)).send({}).expect(400);
  });

  it('ensureHorizon({ organizationId }) cobre so as turmas elegiveis do grupo; grupo INATIVO nao gera', async () => {
    const eligible = await prisma.class.count({
      where: { organizationId: orgB.organizationId, status: 'ACTIVE', autoGenerateLessons: true, weekday: { not: null } },
    });
    const group = await rolling.ensureHorizon({ organizationId: orgB.organizationId });
    assert.equal(group.classes, eligible);
    assert.equal(group.created, 0, 'tudo ja estava no horizonte');
    assert.equal(group.failed, 0);

    await prisma.organization.update({ where: { id: orgB.organizationId }, data: { status: 'INACTIVE' } });
    try {
      assert.equal((await rolling.ensureHorizon({ organizationId: orgB.organizationId }, new Date(Date.now() + 40 * DAY))).classes, 0);
    } finally {
      await prisma.organization.update({ where: { id: orgB.organizationId }, data: { status: 'ACTIVE' } });
    }
  });
});
