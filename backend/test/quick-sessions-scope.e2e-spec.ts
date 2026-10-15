import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createSecondOrg, DEV_PASSWORD, loginAs, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Chamada rapida: cada PROFESSOR/INSTRUTOR/MONITOR so enxerga e marca presenca nas aulas de HOJE das turmas em que e o
 * responsavel (Class.teacherUserId) ou das aulas atribuidas a ele (Lesson.teacherUserId); o MESTRE ve o grupo todo.
 * Bug de producao: o filtro "so as minhas" existia so para MONITOR, entao professor/instrutor viam as turmas dos outros.
 * Organizacao PROPRIA (createSecondOrg): a lista e' exata.
 */
describe('Chamada rapida: escopo por responsavel da turma (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let orgB: SecondOrg;
  const extraUserIds: number[] = [];
  const today = new Date(`${todaySaoPaulo()}T00:00:00.000Z`);

  type Staff = { userId: number; token: string };
  let profA: Staff;
  let profB: Staff;
  let instrA: Staff;
  let instrB: Staff;
  let monA: Staff;
  let monB: Staff;
  let alunoToken: string;
  let studentId: number;
  const L: Record<string, number> = {};
  let unit2: number;

  async function member(kind: string, role: OrgRole): Promise<Staff & { email: string }> {
    const email = `${kind}-${Date.now()}-${Math.floor(Math.random() * 100000)}@e2e-qscope.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `E2E ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    extraUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgB.organizationId, userId: user.id, role, status: 'ACTIVE' } });
    return { email, userId: user.id, token: (await loginAs(app, email)).token };
  }

  const ids = async (who: Staff) =>
    ((await http().get('/api/attendance/quick-sessions').set(auth(who.token)).expect(200)).body as Array<{ lessonId: number }>)
      .map((s) => s.lessonId)
      .sort((a, b) => a - b);
  const sorted = (...keys: string[]) => keys.map((k) => L[k]).sort((a, b) => a - b);

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    orgB = await createSecondOrg(app, prisma, 'qscope');
    const organizationId = orgB.organizationId;
    profA = await member('profa', OrgRole.PROFESSOR);
    profB = await member('profb', OrgRole.PROFESSOR);
    instrA = await member('instra', OrgRole.INSTRUTOR);
    instrB = await member('instrb', OrgRole.INSTRUTOR);
    monA = await member('mona', OrgRole.MONITOR);
    monB = await member('monb', OrgRole.MONITOR);
    alunoToken = (await member('aluno', OrgRole.ALUNO)).token;

    const unit1 = (await prisma.unit.create({ data: { organizationId, name: 'Unidade Um', isMain: true } })).id;
    unit2 = (await prisma.unit.create({ data: { organizationId, name: 'Unidade Dois' } })).id;
    studentId = (await prisma.student.create({ data: { organizationId, name: 'Aluno Escopo' } })).id;

    const mkClass = async (key: string, data: { teacherUserId?: number; status?: 'ACTIVE' | 'INACTIVE'; unitId?: number }) => {
      const c = await prisma.class.create({ data: { organizationId, name: key, autoGenerateLessons: false, unitId: unit1, ...data } });
      await prisma.classStudent.create({ data: { organizationId, classId: c.id, studentId } });
      return c.id;
    };
    const mkLesson = async (key: string, classId: number, data: { teacherUserId?: number; status?: 'ACTIVE' | 'INACTIVE' } = {}) => {
      L[key] = (await prisma.lesson.create({ data: { organizationId, classId, date: today, ...data } })).id;
    };
    const cProfA = await mkClass('Turma ProfA', { teacherUserId: profA.userId });
    const cProfB = await mkClass('Turma ProfB', { teacherUserId: profB.userId });
    const cInstrA = await mkClass('Turma InstrA', { teacherUserId: instrA.userId });
    const cInstrB = await mkClass('Turma InstrB', { teacherUserId: instrB.userId });
    const cMonA = await mkClass('Turma MonA', { teacherUserId: monA.userId });
    const cMonB = await mkClass('Turma MonB', { teacherUserId: monB.userId });
    const cNoTeacher = await mkClass('Turma sem responsavel', {});
    const cProfAInactive = await mkClass('Turma ProfA inativa', { teacherUserId: profA.userId, status: 'INACTIVE' });
    const cProfAUnit2 = await mkClass('Turma ProfA unidade 2', { teacherUserId: profA.userId, unitId: unit2 });
    await mkLesson('profA', cProfA);
    await mkLesson('profACancelled', cProfA, { status: 'INACTIVE' });
    await mkLesson('profB', cProfB);
    await mkLesson('profBCancelled', cProfB, { status: 'INACTIVE' });
    await mkLesson('profBAssignedToA', cProfB, { teacherUserId: profA.userId }); // aula atribuida a A numa turma do B
    await mkLesson('instrA', cInstrA);
    await mkLesson('instrB', cInstrB);
    await mkLesson('monA', cMonA);
    await mkLesson('monB', cMonB);
    await mkLesson('noTeacher', cNoTeacher);
    await mkLesson('profAInactiveClass', cProfAInactive);
    await mkLesson('profAUnit2', cProfAUnit2);
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

  it('PROFESSOR so ve as aulas das turmas dele (+ aula atribuida a ele, + a cancelada propria); nada do professor B nem sem responsavel', async () => {
    assert.deepEqual(await ids(profA), sorted('profA', 'profACancelled', 'profBAssignedToA', 'profAUnit2'));
    assert.deepEqual(await ids(profB), sorted('profB', 'profBCancelled', 'profBAssignedToA')); // responsavel da turma tambem ve a aula atribuida a outro
  });

  it('INSTRUTOR e MONITOR: cada um so as da propria turma; um nao ve a do outro', async () => {
    assert.deepEqual(await ids(instrA), sorted('instrA'));
    assert.deepEqual(await ids(instrB), sorted('instrB'));
    assert.deepEqual(await ids(monA), sorted('monA'));
    assert.deepEqual(await ids(monB), sorted('monB'));
  });

  it('MESTRE continua vendo todas as aulas de hoje do grupo (turma inativa fora)', async () => {
    const all = await ids({ userId: orgB.userId, token: orgB.token });
    assert.deepEqual(all, sorted('profA', 'profACancelled', 'profB', 'profBCancelled', 'profBAssignedToA', 'instrA', 'instrB', 'monA', 'monB', 'noTeacher', 'profAUnit2'));
    assert.ok(!all.includes(L.profAInactiveClass), 'turma inativa nunca entra');
  });

  it('escopo de unidade soma ao de responsavel: profA restrito a unidade 1 perde a aula da turma dele na unidade 2', async () => {
    const unit1 = (await prisma.unit.findFirstOrThrow({ where: { organizationId: orgB.organizationId, isMain: true } })).id;
    await prisma.userUnitAccess.create({ data: { organizationId: orgB.organizationId, userId: profA.userId, unitId: unit1 } });
    assert.deepEqual(await ids(profA), sorted('profA', 'profACancelled', 'profBAssignedToA'));
    await prisma.userUnitAccess.deleteMany({ where: { organizationId: orgB.organizationId, userId: profA.userId } });
  });

  it('chamada: professor A le/marca a propria aula (201) mas aula do professor B = 404 (ler e marcar) e nada e gravado', async () => {
    await http().get(`/api/attendance/lessons/${L.profA}`).set(auth(profA.token)).expect(200);
    await http().post(`/api/attendance/lessons/${L.profA}`).set(auth(profA.token)).send([{ studentId, present: true }]).expect(201);
    await http().get(`/api/attendance/lessons/${L.profB}`).set(auth(profA.token)).expect(404);
    await http().post(`/api/attendance/lessons/${L.profB}`).set(auth(profA.token)).send([{ studentId, present: true }]).expect(404);
    await http().post(`/api/attendance/lessons/${L.noTeacher}`).set(auth(profA.token)).send([{ studentId, present: true }]).expect(404);
    assert.equal(await prisma.attendance.count({ where: { lessonId: { in: [L.profB, L.noTeacher] } } }), 0, 'nada gravado em aula alheia');
    // instrutor/monitor idem
    await http().post(`/api/attendance/lessons/${L.instrB}`).set(auth(instrA.token)).send([{ studentId, present: true }]).expect(404);
    await http().post(`/api/attendance/lessons/${L.monB}`).set(auth(monA.token)).send([{ studentId, present: true }]).expect(404);
    await http().get(`/api/attendance/lessons/${L.profB}/checkin-token`).set(auth(profA.token)).expect(404);
    // MESTRE marca qualquer aula
    await http().post(`/api/attendance/lessons/${L.profB}`).set(auth(orgB.token)).send([{ studentId, present: false }]).expect(201);
    await http().get(`/api/attendance/lessons/${L.noTeacher}`).set(auth(orgB.token)).expect(200);
  });

  it('GET /attendance (lista) do professor A so traz presencas das aulas dele; ALUNO segue 403 e sem token 401', async () => {
    const list = (await http().get('/api/attendance').set(auth(profA.token)).expect(200)).body as Array<{ lessonId: number }>;
    assert.ok(list.length >= 1);
    assert.ok(list.every((a) => [L.profA, L.profACancelled, L.profBAssignedToA, L.profAUnit2].includes(a.lessonId)));
    await http().get('/api/attendance/quick-sessions').set(auth(alunoToken)).expect(403);
    await http().get('/api/attendance/quick-sessions').expect(401);
  });
});
