import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createReportOrg, ReportOrg } from './utils/report-fixtures';
import { createSecondOrg, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Relatórios: GET /reports/{attendance,finance,students,graduations} (+ attendance/export.csv). Grupo próprio com
 * números conhecidos; segunda via independente = os próprios dados semeados por Prisma (somas feitas à mão no teste).
 *
 * Dados (hoje = D):
 *  - alunos: s1 (A, ativo, 11 anos, ingresso D-10), s2 (A, ativo, adulto, D-40), s3 (B, inativo, D-100), s4 (B, ativo, sem nascimento);
 *  - turmas: ca (unidade A), cb (unidade B); aulas L1,L2 (ca, D-3/D-2), L3 (cb, D-1), L4 (ca, INATIVA — fora do relatório);
 *  - presenças: L1 s1=P s2=F; L2 s1=P s2=P; L3 s4=P s3=F; L4 s1=F (ignorada);
 *  - graduações: s1 Crua D-30, s2 Amarela D-20, s1 Amarela D-5, s4 Crua D-3, s1 Crua D-400 (fora do padrão de 12 meses).
 */
describe('Relatórios (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  let classA: number;
  let classB: number;

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const day = (offset: number) => new Date(`${todaySaoPaulo(offset)}T00:00:00.000Z`);
  const year = Number(todaySaoPaulo(0).slice(0, 4));

  before(async () => {
    app = await createTestApp();
    org = await createReportOrg(app, prisma, 'reports');
    orgB = await createSecondOrg(app, prisma, 'reportsb');
    const o = org.organizationId;

    const mk = (name: string, unitId: number, extra: object = {}) =>
      prisma.student.create({ data: { organizationId: o, unitId, name: `${name} E2E`, ...extra } });
    const s1 = await mk('Ana', org.unitA.id, { birthDate: new Date(`${year - 11}-01-01T00:00:00Z`), joinedAt: day(-10) });
    const s2 = await mk('Bruno', org.unitA.id, { birthDate: new Date(`${year - 36}-01-01T00:00:00Z`), joinedAt: day(-40) });
    const s3 = await mk('Carla', org.unitB.id, { status: 'INACTIVE', joinedAt: day(-100) });
    const s4 = await mk('Davi', org.unitB.id);

    classA = (await prisma.class.create({ data: { organizationId: o, unitId: org.unitA.id, name: 'Turma A E2E' } })).id;
    classB = (await prisma.class.create({ data: { organizationId: o, unitId: org.unitB.id, name: 'Turma B E2E' } })).id;
    const lesson = (classId: number, date: Date, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
      prisma.lesson.create({ data: { organizationId: o, classId, date, status } });
    const l1 = await lesson(classA, day(-3));
    const l2 = await lesson(classA, day(-2));
    const l3 = await lesson(classB, day(-1));
    const l4 = await lesson(classA, day(-1), 'INACTIVE');
    const att = (lessonId: number, studentId: number, present: boolean) => ({ organizationId: o, lessonId, studentId, present });
    await prisma.attendance.createMany({
      data: [att(l1.id, s1.id, true), att(l1.id, s2.id, false), att(l2.id, s1.id, true), att(l2.id, s2.id, true), att(l3.id, s4.id, true), att(l3.id, s3.id, false), att(l4.id, s1.id, false)],
    });

    const system = await prisma.graduationSystem.create({ data: { organizationId: o, name: 'Cordas E2E' } });
    const crua = await prisma.graduationLevel.create({ data: { organizationId: o, graduationSystemId: system.id, name: 'Crua', order: 0, color: '#eeeeee' } });
    const amarela = await prisma.graduationLevel.create({ data: { organizationId: o, graduationSystemId: system.id, name: 'Amarela', order: 1 } });
    const grad = (studentId: number, graduationLevelId: number, offset: number) => ({ organizationId: o, studentId, graduationLevelId, graduatedAt: day(offset) });
    await prisma.studentGraduation.createMany({
      data: [grad(s1.id, crua.id, -30), grad(s2.id, amarela.id, -20), grad(s1.id, amarela.id, -5), grad(s4.id, crua.id, -3), grad(s1.id, crua.id, -400)],
    });

    const rec = (extra: object) => ({ organizationId: o, description: 'Lançamento E2E', ...extra });
    await prisma.financialRecord.createMany({
      data: [
        rec({ studentId: s1.id, unitId: org.unitA.id, amountCents: 10000, dueDate: day(-20), status: 'PAID', paidAt: day(-18), paidCents: 9000 }),
        rec({ studentId: s1.id, unitId: org.unitA.id, amountCents: 20000, dueDate: day(3), status: 'PENDING' }),
        rec({ studentId: s3.id, unitId: org.unitB.id, amountCents: 30000, dueDate: day(-5), status: 'PENDING' }),
        rec({ studentId: s3.id, unitId: org.unitB.id, amountCents: 5000, dueDate: day(-1), status: 'OVERDUE' }),
        rec({ studentId: s2.id, unitId: org.unitA.id, amountCents: 7777, dueDate: day(-2), status: 'CANCELLED' }),
        rec({ studentId: s2.id, unitId: org.unitA.id, amountCents: 4444, dueDate: day(-200), status: 'PENDING' }),
      ],
    });
  });

  after(async () => {
    await orgB.cleanup();
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /reports/attendance', () => {
    it('presença por turma e por aluno com % (aula inativa fica fora); filtros de turma e unidade', async () => {
      const res = await get('/reports/attendance', org.mestre.token).expect(200);
      assert.deepEqual(
        [res.body.totals.lessons, res.body.totals.records, res.body.totals.present, res.body.totals.absent, res.body.totals.percent],
        [3, 6, 4, 2, 66.7],
      );
      const byClass = Object.fromEntries(res.body.byClass.map((c: { name: string }) => [c.name, c]));
      assert.deepEqual([byClass['Turma A E2E'].records, byClass['Turma A E2E'].percent], [4, 75]);
      assert.deepEqual([byClass['Turma B E2E'].records, byClass['Turma B E2E'].percent], [2, 50]);
      // menor frequência primeiro: Carla 0%, Bruno 50%, depois os 100% por nome
      assert.deepEqual(
        res.body.byStudent.map((s: { name: string; percent: number }) => [s.name, s.percent]),
        [['Carla E2E', 0], ['Bruno E2E', 50], ['Ana E2E', 100], ['Davi E2E', 100]],
      );
      assert.equal(res.body.byStudentTotal, 4);

      const onlyA = await get(`/reports/attendance?classId=${classA}`, org.mestre.token).expect(200);
      assert.equal(onlyA.body.totals.records, 4);
      const onlyUnitB = await get(`/reports/attendance?unitId=${org.unitB.id}`, org.mestre.token).expect(200);
      assert.equal(onlyUnitB.body.totals.records, 2);
      const window = await get(`/reports/attendance?from=${todaySaoPaulo(-3)}&to=${todaySaoPaulo(-3)}`, org.mestre.token).expect(200);
      assert.equal(window.body.totals.records, 2); // só a aula L1
    });

    it('CSV por aluno (BOM, ";", % com vírgula) respeita os mesmos filtros', async () => {
      const res = await get(`/reports/attendance/export.csv?classId=${classA}`, org.mestre.token).expect(200);
      assert.match(res.headers['content-type'], /text\/csv/);
      assert.equal(res.text.charCodeAt(0), 0xfeff);
      assert.equal(res.text.slice(1).split('\r\n')[0], 'Aluno;Chamadas registradas;Presenças;Faltas;Frequência (%)');
      assert.ok(res.text.includes('Bruno E2E;2;1;1;50\r\n'));
      assert.ok(!res.text.includes('Davi E2E'), 'Davi só tem aula da turma B');
    });

    it('PROFESSOR restrito à unidade A só enxerga A; turma/unidade B => 404; ALUNO 403; outro grupo vazio; período inválido 400', async () => {
      await prisma.userUnitAccess.create({ data: { organizationId: org.organizationId, userId: org.professor.userId, unitId: org.unitA.id } });
      const prof = await get('/reports/attendance', org.professor.token).expect(200);
      assert.equal(prof.body.totals.records, 4);
      assert.deepEqual(prof.body.byClass.map((c: { name: string }) => c.name), ['Turma A E2E']);
      await get(`/reports/attendance?classId=${classB}`, org.professor.token).expect(404);
      await get(`/reports/attendance?unitId=${org.unitB.id}`, org.professor.token).expect(404);

      await get('/reports/attendance', org.aluno.token).expect(403);
      await get('/reports/attendance').expect(401);
      const other = await get('/reports/attendance', orgB.token).expect(200);
      assert.equal(other.body.totals.records, 0);
      await get(`/reports/attendance?classId=${classA}`, orgB.token).expect(404);

      await get('/reports/attendance?from=2026-10-10&to=2026-10-01', org.mestre.token).expect(400);
      await get('/reports/attendance?from=2020-01-01&to=2026-01-01', org.mestre.token).expect(400);
    });
  });

  describe('GET /reports/finance', () => {
    const q = () => `from=${todaySaoPaulo(-40)}&to=${todaySaoPaulo(10)}`;

    it('recebido, a receber e inadimplência (cancelado e fora do período ficam de fora); soma dos meses = totais', async () => {
      const res = await get(`/reports/finance?${q()}`, org.mestre.token).expect(200);
      const t = res.body.totals;
      assert.deepEqual(
        [t.expectedCents, t.receivedCents, t.pendingCents, t.overdueCents, t.overdueCount, t.overdueRatePercent, t.receivedInPeriodCents, t.count],
        [65000, 9000, 20000, 35000, 2, 53.8, 9000, 4],
      );
      const sum = (key: string) => res.body.byMonth.reduce((acc: number, m: Record<string, number>) => acc + (m[key] as number), 0);
      assert.equal(sum('expectedCents'), 65000);
      assert.equal(sum('overdueCents'), 35000);

      const unitB = await get(`/reports/finance?${q()}&unitId=${org.unitB.id}`, org.mestre.token).expect(200);
      assert.deepEqual([unitB.body.totals.expectedCents, unitB.body.totals.overdueCents], [35000, 35000]);
    });

    it('só o MESTRE: PROFESSOR e ALUNO 403; outro grupo zerado; unidade de outro grupo 404', async () => {
      await get(`/reports/finance?${q()}`, org.professor.token).expect(403);
      await get(`/reports/finance?${q()}`, org.aluno.token).expect(403);
      const other = await get(`/reports/finance?${q()}`, orgB.token).expect(200);
      assert.deepEqual([other.body.totals.count, other.body.totals.expectedCents], [0, 0]);
      await get(`/reports/finance?${q()}&unitId=${org.unitA.id}`, orgB.token).expect(404);
    });
  });

  describe('GET /reports/students', () => {
    it('situação, novos no período, por unidade e faixa etária', async () => {
      const res = await get('/reports/students', org.mestre.token).expect(200);
      assert.deepEqual(
        [res.body.totals.total, res.body.totals.active, res.body.totals.inactive, res.body.totals.newInPeriod],
        [4, 3, 1, 4],
      );
      const units = Object.fromEntries(res.body.byUnit.map((u: { unitName: string }) => [u.unitName, u]));
      assert.deepEqual([units[org.unitA.name].active, units[org.unitA.name].total], [2, 2]);
      assert.deepEqual([units[org.unitB.name].active, units[org.unitB.name].inactive, units[org.unitB.name].total], [1, 1, 2]);
      const ages = Object.fromEntries(res.body.byAgeGroup.map((g: { key: string; count: number }) => [g.key, g.count]));
      assert.equal(ages['6a12'], 1);
      assert.equal(ages['30a44'], 1);
      assert.equal(ages['semData'], 1);
      assert.equal(res.body.byMonth.reduce((n: number, m: { newStudents: number }) => n + m.newStudents, 0), 4);
    });

    it('PROFESSOR restrito vê só a unidade A; ALUNO 403; outro grupo zerado', async () => {
      const prof = await get('/reports/students', org.professor.token).expect(200);
      assert.equal(prof.body.totals.total, 2);
      await get('/reports/students', org.aluno.token).expect(403);
      const other = await get('/reports/students', orgB.token).expect(200);
      assert.equal(other.body.totals.total, 0);
    });
  });

  describe('GET /reports/graduations', () => {
    it('graduações por mês e por nível/corda (a de 400 dias atrás fica fora do padrão de 12 meses)', async () => {
      const res = await get('/reports/graduations', org.mestre.token).expect(200);
      assert.deepEqual([res.body.totals.graduations, res.body.totals.students], [4, 3]);
      assert.deepEqual(
        res.body.byLevel.map((l: { levelName: string; count: number }) => [l.levelName, l.count]),
        [['Crua', 2], ['Amarela', 2]],
      );
      assert.equal(res.body.byMonth.reduce((n: number, m: { count: number }) => n + m.count, 0), 4);
      const wide = await get(`/reports/graduations?from=${todaySaoPaulo(-420)}`, org.mestre.token).expect(200);
      assert.equal(wide.body.totals.graduations, 5);
    });

    it('PROFESSOR restrito vê só alunos da unidade A; ALUNO 403; outro grupo zerado', async () => {
      const prof = await get('/reports/graduations', org.professor.token).expect(200);
      assert.deepEqual([prof.body.totals.graduations, prof.body.totals.students], [3, 2]);
      await get('/reports/graduations', org.aluno.token).expect(403);
      const other = await get('/reports/graduations', orgB.token).expect(200);
      assert.equal(other.body.totals.graduations, 0);
    });
  });
});
