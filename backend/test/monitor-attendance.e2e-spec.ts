import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { civilTodayStart } from '../src/interface/http/finance/finance.service';
import { DEV_PASSWORD, loginAs } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * MONITOR so marca/edita chamada das turmas em que e o professor responsavel (Class.teacherUserId) ou de aulas atribuidas
 * a ele (Lesson.teacherUserId); a mesma regra vale para PROFESSOR e INSTRUTOR (ownLessonFilter; antes so o MONITOR era filtrado - ver quick-sessions-scope.e2e-spec.ts).
 * Grupo PROPRIO; fixtures "@e2e-monitor.local", limpas no after().
 */
const DOMAIN = '@e2e-monitor.local';

describe('MONITOR - chamada so das proprias turmas/aulas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  const stamp = Date.now();
  let monitor1: { userId: number; token: string };
  let monitor2: { userId: number; token: string };
  let instrutor: { userId: number; token: string };
  let studentId: number;
  let lessonOwn: number; // turma do monitor1
  let lessonOther: number; // turma sem responsavel
  let lessonAssigned: number; // turma sem responsavel, mas aula atribuida ao monitor1

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function makeStaff(kind: string, role: OrgRole) {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-monitor] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token };
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'monitor');
    monitor1 = await makeStaff('monitor1', OrgRole.MONITOR);
    monitor2 = await makeStaff('monitor2', OrgRole.MONITOR);
    instrutor = await makeStaff('instrutor', OrgRole.INSTRUTOR);
    const organizationId = org.organizationId;
    const today = civilTodayStart(new Date());
    const own = await prisma.class.create({ data: { organizationId, name: 'Turma do monitor1', teacherUserId: monitor1.userId, autoGenerateLessons: false } });
    const other = await prisma.class.create({ data: { organizationId, name: 'Turma sem responsavel', autoGenerateLessons: false } });
    const student = await prisma.student.create({ data: { organizationId, name: '[e2e-monitor] aluno' } });
    studentId = student.id;
    for (const c of [own, other]) await prisma.classStudent.create({ data: { organizationId, classId: c.id, studentId, status: 'ACTIVE' } });
    lessonOwn = (await prisma.lesson.create({ data: { organizationId, classId: own.id, date: today } })).id;
    lessonOther = (await prisma.lesson.create({ data: { organizationId, classId: other.id, date: today } })).id;
    lessonAssigned = (await prisma.lesson.create({ data: { organizationId, classId: other.id, date: today, teacherUserId: monitor1.userId } })).id;
  });

  after(async () => {
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.organizationUser.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('feliz: o monitor ve a lista, marca e le a chamada da turma dele e da aula atribuida a ele', async () => {
    for (const lessonId of [lessonOwn, lessonAssigned]) {
      const roster = await http().get(`/api/attendance/lessons/${lessonId}`).set(auth(monitor1.token)).expect(200);
      assert.equal(roster.body.length, 1);
      await http().post(`/api/attendance/lessons/${lessonId}`).set(auth(monitor1.token)).send([{ studentId, present: true }]).expect(201);
    }
    await http().get(`/api/attendance/lessons/${lessonOwn}/checkin-token`).set(auth(monitor1.token)).expect(200);
    const sessions = (await http().get('/api/attendance/quick-sessions').set(auth(monitor1.token)).expect(200)).body as Array<{ lessonId: number }>;
    assert.deepEqual(sessions.map((s) => s.lessonId).sort(), [lessonOwn, lessonAssigned].sort());
  });

  it('erro: aula de turma alheia = 404 (ler, marcar, QR) e nao entra na lista nem na chamada rapida; outro monitor tambem 404', async () => {
    await http().get(`/api/attendance/lessons/${lessonOther}`).set(auth(monitor1.token)).expect(404);
    await http().post(`/api/attendance/lessons/${lessonOther}`).set(auth(monitor1.token)).send([{ studentId, present: true }]).expect(404);
    await http().get(`/api/attendance/lessons/${lessonOther}/checkin-token`).set(auth(monitor1.token)).expect(404);
    await http().get(`/api/attendance/lessons/${lessonOwn}`).set(auth(monitor2.token)).expect(404);
    assert.equal(await prisma.attendance.count({ where: { lessonId: lessonOther } }), 0, 'nada gravado na aula alheia');
    const list = (await http().get('/api/attendance').set(auth(monitor1.token)).expect(200)).body as Array<{ lessonId: number }>;
    assert.ok(list.length >= 2 && list.every((a) => a.lessonId !== lessonOther));
    assert.deepEqual((await http().get('/api/attendance/quick-sessions').set(auth(monitor2.token)).expect(200)).body, []);
  });

  it('INSTRUTOR e PROFESSOR agora seguem a mesma regra (so as proprias); MESTRE continua vendo todas as aulas do grupo', async () => {
    await http().get(`/api/attendance/lessons/${lessonOther}`).set(auth(instrutor.token)).expect(404);
    await http().post(`/api/attendance/lessons/${lessonOther}`).set(auth(org.professor.token)).send([{ studentId, present: false }]).expect(404);
    await http().get(`/api/attendance/lessons/${lessonOwn}`).set(auth(org.mestre.token)).expect(200);
    await http().get(`/api/attendance/lessons/${lessonOther}`).set(auth(org.mestre.token)).expect(200);
  });
});
