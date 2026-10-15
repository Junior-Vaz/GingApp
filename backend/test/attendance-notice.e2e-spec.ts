import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { buildCheckinToken } from '../src/shared/checkin/checkin-token';
import { NotificationsService } from '../src/interface/http/notifications/notifications.service';
import { pushCategoryOf, buildPushPayload } from '../src/shared/push/push.config';
import { DEV_PASSWORD, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { ReportOrg, createReportOrg } from './utils/report-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Aviso "Presença registrada": a chamada (POST /attendance/lessons/:id) e o check-in por QR notificam o aluno presente
 * (se tiver login) e os responsáveis com login; ausente não; re-salvar não duplica; o grupo pode desligar; falha na
 * notificação nunca derruba o salvamento. Grupo PRÓPRIO (não toca seed/demo); fixtures "@e2e-presenca.local".
 */
const DOMAIN = '@e2e-presenca.local';
const TYPE = 'ATTENDANCE_PRESENT';

describe('Aviso de presença (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  const stamp = Date.now();
  let classId: number;
  let alunoA: { userId: number; token: string; studentId: number }; // aluno com login
  let guardian1: { userId: number; token: string }; // responsável de A e de B
  let guardian2: { userId: number; token: string }; // responsável de C
  let studentB: number; // dependente sem login (responsável 1)
  let studentC: number; // dependente sem login (responsável 2)
  let studentD: number; // sem login nem responsável

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lessonDate = () => new Date(`${todaySaoPaulo(0)}T00:00:00.000Z`);
  const newLesson = async (startTime: string | null = '19:00') =>
    (await prisma.lesson.create({ data: { organizationId: org.organizationId, classId, date: lessonDate(), startTime } })).id;
  const mark = (lessonId: number, token: string, entries: Array<{ studentId: number; present: boolean }>) =>
    http().post(`/api/attendance/lessons/${lessonId}`).set(auth(token)).send(entries);
  const notices = (userId: number) => prisma.notification.findMany({ where: { userId, type: TYPE }, orderBy: { id: 'asc' } });
  const count = (userId: number) => prisma.notification.count({ where: { userId, type: TYPE } });
  const setFlag = (value: boolean) =>
    http().patch('/api/organizations/me').set(auth(org.mestre.token)).send({ attendanceNotifications: value });

  async function makeUser(kind: string, role: OrgRole) {
    const email = `${kind}-${stamp}${DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `[e2e-presenca] ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId: org.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token };
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    org = await createReportOrg(app, prisma, 'presenca');
    const organizationId = org.organizationId;
    // teacherUserId: o PROFESSOR so marca chamada das turmas em que e o responsavel (ownLessonFilter).
    const klass = await prisma.class.create({ data: { organizationId, name: 'Turma Presença', startTime: '18:00', autoGenerateLessons: false, teacherUserId: org.professor.userId } });
    classId = klass.id;

    const a = await makeUser('alunoA', OrgRole.ALUNO);
    guardian1 = await makeUser('resp1', OrgRole.RESPONSAVEL);
    guardian2 = await makeUser('resp2', OrgRole.RESPONSAVEL);
    const sA = await prisma.student.create({ data: { organizationId, userId: a.userId, name: 'Ana Beatriz Lima' } });
    alunoA = { ...a, studentId: sA.id };
    studentB = (await prisma.student.create({ data: { organizationId, name: 'Bruno Costa' } })).id;
    studentC = (await prisma.student.create({ data: { organizationId, name: 'Carla Dias' } })).id;
    studentD = (await prisma.student.create({ data: { organizationId, name: 'Daniel Souza' } })).id;
    await prisma.studentGuardian.createMany({
      data: [
        { organizationId, studentId: sA.id, userId: guardian1.userId, name: 'Resp 1' },
        { organizationId, studentId: studentB, userId: guardian1.userId, name: 'Resp 1' },
        { organizationId, studentId: studentC, userId: guardian2.userId, name: 'Resp 2' },
      ],
    });
    for (const studentId of [sA.id, studentB, studentC, studentD]) {
      await prisma.classStudent.create({ data: { organizationId, classId, studentId, status: 'ACTIVE' } });
    }
  });

  after(async () => {
    await org.cleanup();
    const ids = (await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } })).map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('feliz: presente notifica o aluno (com login) e os responsáveis (com login); ausente e sem login não geram nada', async () => {
    const lessonId = await newLesson('19:00');
    await mark(lessonId, org.professor.token, [
      { studentId: alunoA.studentId, present: true },
      { studentId: studentB, present: true },
      { studentId: studentC, present: false }, // ausente => nada
      { studentId: studentD, present: true }, // presente, mas sem login/responsável => nada
    ]).expect(201);

    const own = await notices(alunoA.userId);
    assert.equal(own.length, 1);
    assert.equal(own[0].title, 'Presença registrada');
    assert.match(own[0].body, /^Você esteve presente em Turma Presença — (domingo|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado), \d{2}\/\d{2} às 19:00$/);
    const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(lessonDate());
    assert.ok(own[0].body.includes(`— ${weekday}, `), `dia da semana esperado: ${weekday} | ${own[0].body}`);
    assert.equal(own[0].organizationId, org.organizationId);

    // o responsável 1 tem dois dependentes presentes (Ana e Bruno): uma notificação para cada, pelo nome curto
    const g1 = await notices(guardian1.userId);
    assert.deepEqual(g1.map((n) => n.body.split(' esteve')[0]).sort(), ['Ana', 'Bruno']);
    assert.ok(g1.every((n) => n.body.includes('esteve presente em Turma Presença — ')));

    assert.equal(await count(guardian2.userId), 0, 'ausente não notifica o responsável');
  });

  it('idempotência: re-salvar a mesma chamada (e ausente -> presente -> ausente -> presente) não duplica; quem entra depois recebe a sua vez', async () => {
    const lessonId = await newLesson();
    const first = [{ studentId: alunoA.studentId, present: true }, { studentId: studentC, present: false }];
    await mark(lessonId, org.mestre.token, first).expect(201);
    const a1 = await count(alunoA.userId);
    const g2 = await count(guardian2.userId);
    await mark(lessonId, org.mestre.token, first).expect(201);
    assert.equal(await count(alunoA.userId), a1, 're-salvar igual não duplica');

    // A vira ausente e volta a presente; C passa de ausente a presente
    await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: false }]).expect(201);
    await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: true }, { studentId: studentC, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), a1, 'voltar a presente não avisa de novo (já avisado nesta aula)');
    assert.equal(await count(guardian2.userId), g2 + 1, 'C ficou presente pela 1ª vez nesta aula');
    // outra aula => aviso de novo
    const other = await newLesson();
    await mark(other, org.mestre.token, [{ studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), a1 + 1);
    // entrada duplicada no mesmo corpo: vale a última (presente), 1 aviso
    const dup = await newLesson();
    const before = await count(alunoA.userId);
    await mark(dup, org.mestre.token, [{ studentId: alunoA.studentId, present: false }, { studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), before + 1);
  });

  it('configuração: GET /organizations devolve a flag; desligada não notifica nem avisa depois ao re-salvar; religada volta', async () => {
    const own = await http().get('/api/organizations').set(auth(org.mestre.token)).expect(200);
    assert.equal(own.body.attendanceNotifications, true, 'padrão ligado');
    await http().patch('/api/organizations/me').set(auth(org.professor.token)).send({ attendanceNotifications: false }).expect(403);
    await http().patch('/api/organizations/me').set(auth(org.mestre.token)).send({ attendanceNotifications: 'nao' }).expect(400);

    const off = await setFlag(false).expect(200);
    assert.equal(off.body.attendanceNotifications, false);
    assert.equal((await http().get('/api/organizations').set(auth(org.mestre.token)).expect(200)).body.attendanceNotifications, false);

    const lessonId = await newLesson();
    const before = await count(alunoA.userId);
    await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), before, 'desligado: não notifica');
    assert.equal(await prisma.attendance.count({ where: { lessonId, present: true } }), 1, 'a chamada foi salva normalmente');

    await setFlag(true).expect(200);
    await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), before, 'religar não dispara aviso atrasado de chamada antiga');
    const next = await newLesson();
    await mark(next, org.mestre.token, [{ studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), before + 1, 'religado: aulas novas notificam');
  });

  it('falha na notificação nunca derruba o salvamento da chamada', async () => {
    const notifications = app.get(NotificationsService);
    const original = notifications.createMany.bind(notifications);
    notifications.createMany = async () => {
      throw new Error('falha simulada do banco de notificações');
    };
    try {
      const lessonId = await newLesson();
      const before = await count(alunoA.userId);
      await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: true }, { studentId: studentB, present: true }]).expect(201);
      assert.equal(await prisma.attendance.count({ where: { lessonId, present: true } }), 2, 'presenças gravadas');
      assert.equal(await count(alunoA.userId), before, 'sem notificação (falhou), mas sem erro para o cliente');
    } finally {
      notifications.createMany = original;
    }
  });

  it('check-in por QR usa o mesmo aviso e não duplica o da chamada; aluno de outro grupo/aula nunca entra', async () => {
    // QR primeiro: avisa; a chamada depois (mesmo aluno presente) não avisa de novo
    const lessonId = await newLesson(null); // sem horário próprio (herda 18:00 da turma no texto; a janela do QR é o dia todo)
    const before = await count(alunoA.userId);
    const token = buildCheckinToken('L', lessonId, org.organizationId);
    await http().post('/api/attendance/self-checkin').set(auth(alunoA.token)).send({ token }).expect(200);
    const afterQr = await notices(alunoA.userId);
    assert.equal(afterQr.length, before + 1);
    assert.match(afterQr[afterQr.length - 1].body, / — .*, \d{2}\/\d{2} às 18:00$/, 'aula sem horário própria: usa o horário da turma');
    await mark(lessonId, org.mestre.token, [{ studentId: alunoA.studentId, present: true }]).expect(201);
    assert.equal(await count(alunoA.userId), before + 1);

    // aluno de outro grupo no corpo => 400 e nada gravado
    const foreign = await prisma.student.findFirstOrThrow({ where: { organizationId: { not: org.organizationId } }, select: { id: true } });
    await mark(lessonId, org.mestre.token, [{ studentId: foreign.id, present: true }]).expect(400);
    assert.equal(await prisma.attendanceNotice.count({ where: { studentId: foreign.id, lessonId } }), 0);
  });

  it('push: ATTENDANCE_PRESENT entra na categoria "lessons" (preferências existentes) e abre /frequencia', () => {
    assert.equal(pushCategoryOf(TYPE), 'lessons');
    const payload = buildPushPayload({ title: 'Presença registrada', body: 'Você esteve presente em X', type: TYPE });
    assert.equal(payload.url, '/frequencia');
    assert.equal(payload.tag, 'gingapp-lessons');
    assert.equal(buildPushPayload({ title: 'a', body: 'b', type: 'LESSON_CANCELLED' }).url, '/aulas', 'demais tipos de aula inalterados');
  });
});
