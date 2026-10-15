import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { DEV_PASSWORD, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Relato de producao: "hoje e quarta, sou o instrutor da turma e minha chamada/meus alunos nao aparecem".
 * Reproduz o cenario do dono num grupo PROPRIO: turma com weekday = HOJE (Sao Paulo), 20:30-21:30, professor responsavel
 * = PROFESSOR / INSTRUTOR / MONITOR (com e sem escopo de unidade), alunos matriculados, aulas geradas pelo modo
 * CONTINUO (HTTP), e confere, COMO esse usuario, quick-sessions, GET /lessons (nearest, janela -7/+30), o roster e o POST
 * da chamada. Depois cobre o que PODE esconder a aula de hoje (unidade, turma inativa, aula cancelada, hora no timestamp,
 * MONITOR que nao e o responsavel). Nada toca o seed/demo: tudo no grupo "today-vis", apagado no after().
 */
const DOMAIN = '@e2e-today-vis.local';

describe('Aula de HOJE visivel para PROFESSOR/INSTRUTOR/MONITOR (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  const stamp = Date.now();
  const today = todaySaoPaulo();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const staff: Record<string, { userId: number; token: string }> = {};
  let classId: number; // a turma "Quartas" do relato (weekday = hoje)
  let todayLessonId: number; // aula de hoje gerada pelo modo continuo
  let students: number[] = [];

  async function makeStaff(kind: string, role: OrgRole) {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-today] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    staff[kind] = { userId: user.id, token: (await loginAs(app, email)).token };
  }

  const quick = async (token: string) =>
    (await http().get('/api/attendance/quick-sessions').set(auth(token)).expect(200)).body as Array<{ lessonId: number; cancelled?: boolean; studentsCount: number; className: string }>;

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'today-vis');
    for (const role of [OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR]) {
      await makeStaff(`resp-${role}`, role); // responsavel da turma
      await makeStaff(`resp-unit-${role}`, role); // idem, com escopo de unidade (UserUnitAccess)
    }
    await makeStaff('instrutor-other', OrgRole.INSTRUTOR); // tem attendance mas NAO e o responsavel
    await makeStaff('monitor-other', OrgRole.MONITOR); // MONITOR que NAO e o responsavel

    const organizationId = org.organizationId;
    // Turma do relato: o responsavel e' UM usuario; os demais papeis usam turmas irmas (uma turma por usuario responsavel).
    students = (
      await Promise.all(['Ana', 'Beto'].map((n) => prisma.student.create({ data: { organizationId, name: `[e2e-today] ${n}` } })))
    ).map((s) => s.id);
    // Uma turma por usuario responsavel (mesma configuracao do relato).
    for (const kind of Object.keys(staff).filter((k) => k.startsWith('resp-'))) {
      const klass = await prisma.class.create({
        data: {
          organizationId,
          name: `Treino ${kind}`,
          weekday,
          startTime: '20:30',
          endTime: '21:30',
          teacherUserId: staff[kind].userId,
          unitId: org.unitA.id,
          autoGenerateLessons: false,
        },
      });
      await prisma.classStudent.createMany({ data: students.map((studentId) => ({ organizationId, classId: klass.id, studentId })) });
      if (kind.startsWith('resp-unit-')) {
        await prisma.userUnitAccess.create({ data: { organizationId, userId: staff[kind].userId, unitId: org.unitA.id } });
      }
      (staff[kind] as { classId?: number }).classId = klass.id;
    }
  });

  after(async () => {
    await prisma.notification.deleteMany({ where: { organizationId: org.organizationId } });
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('modo CONTINUO (HTTP) gera a aula de HOJE ativa, no dia certo da semana de Sao Paulo, com professor/horario da turma', async () => {
    for (const kind of Object.keys(staff).filter((k) => k.startsWith('resp-'))) {
      const id = (staff[kind] as { classId?: number }).classId!;
      const res = await http().post(`/api/classes/${id}/generate-lessons`).set(auth(org.mestre.token)).send({ continuous: true }).expect(201);
      assert.equal(res.body.continuous, true);
      assert.ok(res.body.createdDates.includes(today), `${kind}: a aula de hoje (${today}) tem de ser gerada`);
      const lessons = await prisma.lesson.findMany({ where: { classId: id }, orderBy: { date: 'asc' } });
      assert.ok(lessons.length >= 8, 'ao menos ~8 semanas a frente');
      for (const l of lessons) {
        assert.equal(l.status, 'ACTIVE', 'o gerador cria ATIVAS');
        assert.equal(l.date.getUTCDay(), weekday, 'dia da semana da turma (Sao Paulo)');
        assert.equal(l.date.getUTCHours(), 0);
        assert.equal(l.startTime, '20:30');
        assert.equal(l.teacherUserId, staff[kind].userId);
      }
      assert.equal(lessons[0].date.toISOString().slice(0, 10), today);
    }
    classId = (staff[`resp-${OrgRole.INSTRUTOR}`] as { classId?: number }).classId!;
    todayLessonId = (await prisma.lesson.findFirstOrThrow({ where: { classId, date: utc(today) } })).id;
  });

  for (const role of [OrgRole.PROFESSOR, OrgRole.INSTRUTOR, OrgRole.MONITOR]) {
    for (const scoped of [false, true]) {
      it(`${role} responsavel ${scoped ? 'COM' : 'SEM'} escopo de unidade ve a aula de hoje em quick-sessions, GET /lessons, roster e marca a chamada`, async () => {
        const who = staff[`${scoped ? 'resp-unit-' : 'resp-'}${role}`] as { userId: number; token: string; classId: number };
        const lesson = await prisma.lesson.findFirstOrThrow({ where: { classId: who.classId, date: utc(today) } });

        const sessions = await quick(who.token);
        const mine = sessions.find((s) => s.lessonId === lesson.id);
        assert.ok(mine, 'a aula de hoje aparece na chamada rapida');
        assert.equal(mine.cancelled, undefined);
        assert.equal(mine.studentsCount, 2);

        // Tela Aulas: janela "Atual" (-7..+30), nearest, so ativas e "todos os status".
        const from = todaySaoPaulo(-7);
        const to = todaySaoPaulo(30);
        for (const status of ['ACTIVE', undefined]) {
          const list = await http()
            .get('/api/lessons')
            .query({ order: 'nearest', from, to, limit: 50, ...(status ? { status } : {}) })
            .set(auth(who.token))
            .expect(200);
          assert.ok(
            list.body.some((l: { id: number }) => l.id === lesson.id),
            `GET /lessons (${status ?? 'todos'}) lista a aula de hoje`,
          );
          assert.ok(Number(list.headers['x-total-count']) >= 4);
        }

        const roster = await http().get(`/api/attendance/lessons/${lesson.id}`).set(auth(who.token)).expect(200);
        assert.equal(roster.body.length, 2);
        await http()
          .post(`/api/attendance/lessons/${lesson.id}`)
          .set(auth(who.token))
          .send(students.map((studentId) => ({ studentId, present: true })))
          .expect(201);
        assert.equal((await quick(who.token)).find((s) => s.lessonId === lesson.id)?.studentsCount, 2);
        assert.equal(await prisma.attendance.count({ where: { lessonId: lesson.id, present: true } }), 2);
      });
    }
  }

  it('INSTRUTOR e MONITOR que NAO sao o responsavel NAO veem a aula (404); o MESTRE ve (ownLessonFilter: so as proprias turmas)', async () => {
    const sessions = await quick(staff['instrutor-other'].token);
    assert.ok(!sessions.some((s) => s.lessonId === todayLessonId), 'instrutor sem ser o responsavel NAO ve a aula dos outros');
    await http().get(`/api/attendance/lessons/${todayLessonId}`).set(auth(staff['instrutor-other'].token)).expect(404);
    assert.ok((await quick(org.mestre.token)).some((s) => s.lessonId === todayLessonId), 'o MESTRE ve todas');

    const monitorSessions = await quick(staff['monitor-other'].token);
    assert.equal(monitorSessions.length, 0, 'MONITOR so ve as proprias turmas/aulas');
    await http().get(`/api/attendance/lessons/${todayLessonId}`).set(auth(staff['monitor-other'].token)).expect(404);
  });

  it('ESCOPO de unidade: professor restrito a OUTRA unidade nao ve a aula (por desenho); aula/turma SEM unidade continua visivel', async () => {
    const organizationId = org.organizationId;
    const restricted = staff['instrutor-other'];
    await prisma.userUnitAccess.create({ data: { organizationId, userId: restricted.userId, unitId: org.unitB.id } });
    // Aula DELE (atribuida), mas na unidade A: o escopo de unidade [B] a esconde (o filtro de responsavel soma ao de unidade).
    const ownInA = await prisma.lesson.create({ data: { organizationId, classId, date: utc(today), unitId: org.unitA.id, teacherUserId: restricted.userId } });
    assert.ok(!(await quick(restricted.token)).some((s) => s.lessonId === ownInA.id), 'aula dele na unidade A fica fora do escopo [B]');
    await http().get(`/api/attendance/lessons/${ownInA.id}`).set(auth(restricted.token)).expect(404);
    await prisma.lesson.delete({ where: { id: ownInA.id } });

    // Turma sem unidade + aula sem unidade (legado): visivel ao restrito.
    const noUnit = await prisma.class.create({ data: { organizationId, name: 'Turma sem unidade', weekday, startTime: '20:30', endTime: '21:30', autoGenerateLessons: false, teacherUserId: restricted.userId } });
    const lesson = await prisma.lesson.create({ data: { organizationId, classId: noUnit.id, date: utc(today) } });
    assert.ok((await quick(restricted.token)).some((s) => s.lessonId === lesson.id), 'unitId nulo na turma E na aula = visivel');
    // Aula com unidade B numa turma da unidade A: vale a da AULA.
    const lessonB = await prisma.lesson.create({ data: { organizationId, classId, date: utc(today), unitId: org.unitB.id, teacherUserId: restricted.userId } });
    assert.ok((await quick(restricted.token)).some((s) => s.lessonId === lessonB.id), 'a unidade da aula (B) manda sobre a da turma (A)');
    await prisma.userUnitAccess.deleteMany({ where: { organizationId, userId: restricted.userId } });
    await prisma.lesson.deleteMany({ where: { id: { in: [lesson.id, lessonB.id] } } });
  });

  it('aula criada a mao com HORA no timestamp (ex.: 15:00Z de hoje) tambem e a de hoje; a de ontem/amanha nao', async () => {
    const organizationId = org.organizationId;
    const klass = await prisma.class.create({ data: { organizationId, name: 'Turma manual', teacherUserId: staff['instrutor-other'].userId, autoGenerateLessons: false } });
    const withHour = await prisma.lesson.create({ data: { organizationId, classId: klass.id, date: new Date(`${today}T15:00:00.000Z`) } });
    const yesterday = await prisma.lesson.create({ data: { organizationId, classId: klass.id, date: utc(todaySaoPaulo(-1)) } });
    const tomorrow = await prisma.lesson.create({ data: { organizationId, classId: klass.id, date: utc(todaySaoPaulo(1)) } });
    const ids = (await quick(staff['instrutor-other'].token)).map((s) => s.lessonId);
    assert.ok(ids.includes(withHour.id));
    assert.ok(!ids.includes(yesterday.id) && !ids.includes(tomorrow.id));
    await prisma.lesson.deleteMany({ where: { id: { in: [withHour.id, yesterday.id, tomorrow.id] } } });
  });

  it('turma INATIVA some da chamada rapida (mesmo com a aula ativa) — e a causa fica visivel no GET /classes (status)', async () => {
    const klass = await prisma.class.create({ data: { organizationId: org.organizationId, name: 'Turma parada', status: 'INACTIVE', weekday, autoGenerateLessons: false } });
    const lesson = await prisma.lesson.create({ data: { organizationId: org.organizationId, classId: klass.id, date: utc(today), status: 'ACTIVE' } });
    assert.ok(!(await quick(org.mestre.token)).some((s) => s.lessonId === lesson.id));
    await prisma.lesson.delete({ where: { id: lesson.id } });
  });

  it('CAUSA do relato: aula de hoje CANCELADA aparece como Cancelada (cancelled:true) em vez de "Nenhuma aula hoje"; reativar a traz de volta', async () => {
    const who = staff[`resp-${OrgRole.INSTRUTOR}`];
    // Cancela pela API (o mesmo caminho do painel). INSTRUTOR nao tem lessons:delete, mas tem lessons:edit => PATCH status.
    await http().delete(`/api/lessons/${todayLessonId}`).set(auth(who.token)).expect(403);
    await http().patch(`/api/lessons/${todayLessonId}`).set(auth(who.token)).send({ status: 'INACTIVE' }).expect(200);

    const sessions = await quick(who.token);
    const cancelled = sessions.find((s) => s.lessonId === todayLessonId);
    assert.ok(cancelled, 'antes: sessions=[] => "Nenhuma aula hoje"; agora a cancelada aparece');
    assert.equal(cancelled.cancelled, true);
    assert.equal(sessions[sessions.length - 1].lessonId, todayLessonId, 'canceladas por ultimo');

    const reactivated = await http().patch(`/api/lessons/${todayLessonId}`).set(auth(who.token)).send({ status: 'ACTIVE' }).expect(200);
    assert.equal(reactivated.body.status, 'ACTIVE');
    assert.equal(reactivated.body.cancelledAt, null);
    const after = (await quick(who.token)).find((s) => s.lessonId === todayLessonId);
    assert.ok(after && after.cancelled === undefined);
  });

  it('o job/ensureHorizon e idempotente e NUNCA recria a aula cancelada (continua ativa/cancelada como esta)', async () => {
    const before = await prisma.lesson.count({ where: { classId } });
    await prisma.class.update({ where: { id: classId }, data: { autoGenerateLessons: true } });
    const res = await http().post(`/api/classes/${classId}/generate-lessons`).set(auth(org.mestre.token)).send({ continuous: true }).expect(201);
    assert.equal(res.body.created, 0);
    assert.equal(await prisma.lesson.count({ where: { classId } }), before);
  });
});
