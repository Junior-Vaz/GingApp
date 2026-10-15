import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { AttendanceService } from '../src/interface/http/attendance/attendance.service';
import { createSecondOrg, DEV_PASSWORD, loginAs, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * GET /attendance/quick-sessions (chamada rapida do painel): aulas de HOJE (dia civil de Sao Paulo) da organizacao visiveis
 * ao usuario. Numa organizacao PROPRIA da suite (createSecondOrg), entao a lista e' exata. O status por horario usa um
 * `now` injetado no service (12:00 em Sao Paulo = 15:00Z, sem horario de verao no Brasil) para nao depender do relogio;
 * o HTTP confere formato, escopo de unidade e 403/401. Confirma tambem o roster e a marcacao que o botao usa.
 */
describe('Chamada rapida: GET /attendance/quick-sessions (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let orgB: SecondOrg;
  let service: AttendanceService;
  let alunoToken: string;
  let profToken: string;
  let profUserId: number;
  const extraUserIds: number[] = [];
  const today = todaySaoPaulo();
  const tomorrow = todaySaoPaulo(1);
  const noon = new Date(`${today}T15:00:00.000Z`); // 12:00 em Sao Paulo
  const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

  let unit1: number;
  let unit2: number;
  let classA: number; // unidade 1, foto, 2 alunos ativos + 1 matricula inativa
  let classB: number; // unidade 2
  let classInactive: number;
  let students: number[] = [];
  const lessons: Record<string, number> = {};

  async function member(kind: string, role: OrgRole) {
    const email = `${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}@e2e-quick.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `E2E ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    extraUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgB.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { userId: user.id, token: (await loginAs(app, email)).token };
  }

  before(async () => {
    app = await createTestApp();
    service = app.get(AttendanceService);
    orgB = await createSecondOrg(app, prisma, 'quick');
    const organizationId = orgB.organizationId;
    alunoToken = (await member('aluno', OrgRole.ALUNO)).token;
    const prof = await member('prof', OrgRole.PROFESSOR);
    profToken = prof.token;
    profUserId = prof.userId;

    unit1 = (await prisma.unit.create({ data: { organizationId, name: 'Unidade Um', isMain: true } })).id;
    unit2 = (await prisma.unit.create({ data: { organizationId, name: 'Unidade Dois' } })).id;
    classA = (await prisma.class.create({ data: { organizationId, unitId: unit1, name: 'Turma A', photo: 'https://cdn.example.com/a.png', autoGenerateLessons: false } })).id;
    classB = (await prisma.class.create({ data: { organizationId, unitId: unit2, name: 'Turma B', autoGenerateLessons: false } })).id;
    classInactive = (await prisma.class.create({ data: { organizationId, unitId: unit1, name: 'Turma Inativa', status: 'INACTIVE', autoGenerateLessons: false } })).id;

    students = (
      await Promise.all(
        ['Ana', 'Beto', 'Caio'].map((name) => prisma.student.create({ data: { organizationId, name: `Aluno ${name}`, photo: name === 'Ana' ? 'https://cdn.example.com/ana.png' : null } })),
      )
    ).map((s) => s.id);
    await prisma.classStudent.createMany({
      data: [
        { organizationId, classId: classA, studentId: students[0] },
        { organizationId, classId: classA, studentId: students[1] },
        { organizationId, classId: classA, studentId: students[2], status: 'INACTIVE' },
        { organizationId, classId: classB, studentId: students[2] },
      ],
    });

    const mk = async (key: string, data: { classId: number; date: Date; startTime?: string | null; endTime?: string | null; status?: 'ACTIVE' | 'INACTIVE'; unitId?: number }) => {
      lessons[key] = (await prisma.lesson.create({ data: { organizationId, ...data } })).id;
    };
    await mk('ended8', { classId: classA, date: utc(today), startTime: '08:00', endTime: '09:00' });
    await mk('ended7', { classId: classB, date: utc(today), startTime: '07:00', endTime: '08:00' });
    await mk('ongoing', { classId: classA, date: utc(today), startTime: '11:30', endTime: '12:30' });
    await mk('allDay', { classId: classB, date: utc(today) });
    await mk('upcoming', { classId: classA, date: utc(today), startTime: '14:00', endTime: '15:00', unitId: unit1 });
    await mk('tomorrow', { classId: classA, date: utc(tomorrow), startTime: '10:00', endTime: '11:00' });
    await mk('cancelled', { classId: classA, date: utc(today), startTime: '10:00', endTime: '11:00', status: 'INACTIVE' });
    await mk('inactiveClass', { classId: classInactive, date: utc(today), startTime: '10:00', endTime: '11:00' });
  });

  after(async () => {
    const organizationId = orgB.organizationId;
    await prisma.attendance.deleteMany({ where: { organizationId } });
    await prisma.lesson.deleteMany({ where: { organizationId } });
    await prisma.classStudent.deleteMany({ where: { organizationId } });
    await prisma.class.deleteMany({ where: { organizationId } });
    await prisma.student.deleteMany({ where: { organizationId } });
    await prisma.userUnitAccess.deleteMany({ where: { organizationId } });
    await prisma.unit.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: extraUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('so hoje (SP), de turmas ativas; ativas primeiro (status por horario; ordem EM ANDAMENTO, PROXIMA, ENCERRADA) e a CANCELADA de hoje por ultimo com cancelled:true; contagens', async () => {
    const out = await service.quickSessions(orgB.organizationId, undefined, noon);
    assert.deepEqual(
      out.map((s) => [s.lessonId, s.status]),
      [
        [lessons.ongoing, 'ONGOING'],
        [lessons.allDay, 'ONGOING'], // sem horario = em andamento o dia todo, por ultimo no grupo
        [lessons.upcoming, 'UPCOMING'],
        [lessons.ended7, 'ENDED'],
        [lessons.ended8, 'ENDED'],
        [lessons.cancelled, 'ENDED'], // cancelada de hoje: aparece por ULTIMO (nao e mais escondida)
      ],
    );
    const cancelledSession = out[5];
    assert.equal(cancelledSession.cancelled, true);
    assert.equal(cancelledSession.className, 'Turma A');
    assert.ok(out.slice(0, 5).every((s) => !('cancelled' in s)), 'aula ativa NAO traz o campo (contrato antigo intacto)');
    assert.ok(!out.some((s) => s.lessonId === lessons.inactiveClass), 'aula de turma INATIVA nao entra, nem cancelada');
    const ongoing = out[0];
    assert.deepEqual(ongoing, {
      lessonId: lessons.ongoing,
      classId: classA,
      className: 'Turma A',
      classPhoto: 'https://cdn.example.com/a.png',
      startTime: '11:30',
      endTime: '12:30',
      unitName: 'Unidade Um',
      status: 'ONGOING',
      studentsCount: 2, // a matricula INACTIVE nao conta
      markedCount: 0,
    });
    assert.equal(out[1].className, 'Turma B');
    assert.equal(out[1].classPhoto, null);
    assert.equal(out[1].unitName, 'Unidade Dois');
    assert.equal(out[1].startTime, null);
    assert.equal(out[1].studentsCount, 1);
  });

  it('o status acompanha o relogio: 06:00 tudo PROXIMA (menos sem horario); 23:00 tudo ENCERRADA (menos sem horario)', async () => {
    const early = await service.quickSessions(orgB.organizationId, undefined, new Date(`${today}T09:00:00.000Z`)); // 06:00 SP
    assert.deepEqual(early.map((s) => s.status), ['ONGOING', 'UPCOMING', 'UPCOMING', 'UPCOMING', 'UPCOMING', 'UPCOMING']);
    assert.equal(early[0].lessonId, lessons.allDay);
    const late = await service.quickSessions(orgB.organizationId, undefined, new Date(`${tomorrow}T02:00:00.000Z`)); // 23:00 SP de hoje
    assert.deepEqual(late.map((s) => s.status), ['ONGOING', 'ENDED', 'ENDED', 'ENDED', 'ENDED', 'ENDED']);
  });

  it('markedCount sobe quando a chamada e lancada (roster e marcacao existentes: GET/POST /attendance/lessons/:id)', async () => {
    const roster = await request(server()).get(`/api/attendance/lessons/${lessons.ongoing}`).set(auth(orgB.token)).expect(200);
    assert.deepEqual(
      roster.body.map((r: { studentName: string; photo: string | null; present: boolean | null }) => [r.studentName, r.photo, r.present]),
      [
        ['Aluno Ana', 'https://cdn.example.com/ana.png', null],
        ['Aluno Beto', null, null],
      ],
    );
    const marked = await request(server())
      .post(`/api/attendance/lessons/${lessons.ongoing}`)
      .set(auth(orgB.token))
      .send([{ studentId: students[0], present: true }])
      .expect(201);
    assert.deepEqual(marked.body, { count: 1 });
    const after = await service.quickSessions(orgB.organizationId, undefined, noon);
    assert.equal(after.find((s) => s.lessonId === lessons.ongoing)?.markedCount, 1);
    assert.equal(after.find((s) => s.lessonId === lessons.allDay)?.markedCount, 0);
  });

  it('HTTP: MESTRE recebe a lista (formato do contrato); sem token 401; ALUNO 403', async () => {
    const res = await request(server()).get('/api/attendance/quick-sessions').set(auth(orgB.token)).expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 6, 'as 5 ativas + a cancelada de hoje aparecem em qualquer horario (so o status muda com o relogio)');
    const base = ['className', 'classId', 'classPhoto', 'endTime', 'lessonId', 'markedCount', 'startTime', 'status', 'studentsCount', 'unitName'];
    for (const item of res.body) {
      assert.deepEqual(Object.keys(item).sort(), (item.cancelled ? [...base, 'cancelled'] : base).sort());
      assert.ok(['UPCOMING', 'ONGOING', 'ENDED'].includes(item.status));
    }
    assert.equal(res.body[5].cancelled, true);
    assert.equal(res.body[5].lessonId, lessons.cancelled);
    await request(server()).get('/api/attendance/quick-sessions').expect(401);
    await request(server()).get('/api/attendance/quick-sessions').set(auth(alunoToken)).expect(403);
  });

  it('escopo de unidade: PROFESSOR restrito a unidade 1 so ve as aulas da unidade 1; sem restricao ve todas', async () => {
    const free = await service.quickSessions(orgB.organizationId, { id: profUserId, userType: 'MEMBER', role: OrgRole.PROFESSOR, organizationId: orgB.organizationId, isSuperAdmin: false } as never, noon);
    assert.equal(free.length, 6, 'professor sem unidades atribuidas ve tudo (inclui a cancelada de hoje)');

    await prisma.userUnitAccess.create({ data: { organizationId: orgB.organizationId, userId: profUserId, unitId: unit1 } });
    const restricted = await service.quickSessions(
      orgB.organizationId,
      { id: profUserId, userType: 'MEMBER', role: OrgRole.PROFESSOR, organizationId: orgB.organizationId, isSuperAdmin: false } as never,
      noon,
    );
    assert.deepEqual(restricted.map((s) => s.lessonId).sort(), [lessons.ongoing, lessons.upcoming, lessons.ended8, lessons.cancelled].sort());
    assert.ok(restricted.every((s) => s.unitName === 'Unidade Um'));

    // Mesmo resultado pelo HTTP (PROFESSOR tem attendance:view) — filtra pelas aulas desta suite.
    const http = await request(server()).get('/api/attendance/quick-sessions').set(auth(profToken)).expect(200);
    assert.ok(http.body.every((s: { unitName: string | null }) => s.unitName === 'Unidade Um'));
    assert.ok(!http.body.some((s: { lessonId: number }) => s.lessonId === lessons.allDay || s.lessonId === lessons.ended7));
  });
});
