import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { ALUNO_EMAIL, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Apagar DE VERDADE aulas e turmas (hard delete, so o Mestre) + lista de alunos da turma:
 *   DELETE /lessons/:id (?confirm=true quando ha presencas), POST /lessons/bulk-delete (so canceladas),
 *   GET /classes/:id/delete-impact, DELETE /classes/:id (?confirm=true), GET /classes/:id/students.
 * Cancelar/inativar continua sendo PATCH { status: 'INACTIVE' }. Fixtures com a tag, apagadas no after().
 */
describe('Apagar aulas e turmas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `[e2e-delete-${Date.now()}]`;
  let mestreToken: string;
  let alunoToken: string;
  let professorToken: string;
  let orgId: number;
  let other: SecondOrg;
  const classIds: number[] = [];
  const studentIds: number[] = [];

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const day = (offset: number) => new Date(Date.UTC(2031, 0, 1 + offset));
  const newClass = async (name: string) => {
    const c = await prisma.class.create({ data: { organizationId: orgId, name: `${tag} ${name}` } });
    classIds.push(c.id);
    return c.id;
  };
  const newStudent = async (name: string) => {
    const s = await prisma.student.create({ data: { organizationId: orgId, name: `${tag} ${name}` } });
    studentIds.push(s.id);
    return s.id;
  };
  const newLesson = (classId: number, offset: number, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
    prisma.lesson.create({ data: { organizationId: orgId, classId, date: day(offset), status } }).then((l) => l.id);

  before(async () => {
    app = await createTestApp();
    const mestre = await loginAs(app, MESTRE_EMAIL);
    mestreToken = mestre.token;
    orgId = mestre.organizationId;
    alunoToken = (await loginAs(app, ALUNO_EMAIL)).token;
    professorToken = (await loginAs(app, 'professor@gingabrasil.com.br')).token;
    other = await createSecondOrg(app, prisma, 'delete');
  });

  after(async () => {
    const lessons = await prisma.lesson.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await prisma.pointEvent.deleteMany({ where: { studentId: { in: studentIds } } });
    await prisma.attendance.deleteMany({ where: { lessonId: { in: lessons.map((l) => l.id) } } });
    await prisma.lesson.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.classStudent.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await other.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('DELETE /lessons/:id sem presencas apaga de verdade (200) e audita LESSON_DELETE', async () => {
    const classId = await newClass('aula sem presenca');
    const lessonId = await newLesson(classId, 1);
    const impact = await http().get(`/api/lessons/${lessonId}/delete-impact`).set(auth(mestreToken)).expect(200);
    assert.deepEqual(impact.body, { attendances: 0 });

    const res = await http().delete(`/api/lessons/${lessonId}`).set(auth(mestreToken)).expect(200);
    assert.equal(res.body.deleted, true);
    assert.equal(await prisma.lesson.count({ where: { id: lessonId } }), 0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'LESSON_DELETE', resourceId: String(lessonId) } });
    assert.equal((audit.metadata as { attendances: number }).attendances, 0);
    await http().delete(`/api/lessons/${lessonId}`).set(auth(mestreToken)).expect(404);
  });

  it('aula COM presenca: sem confirm => 409 com a contagem (nada some); com confirm=true apaga aula, presenca e o ponto do ranking', async () => {
    const classId = await newClass('aula com presenca');
    const studentId = await newStudent('aluno presente');
    const lessonId = await newLesson(classId, 2);
    await prisma.attendance.create({ data: { organizationId: orgId, lessonId, studentId, present: true } });
    await prisma.pointEvent.create({
      data: { organizationId: orgId, studentId, type: 'CLASS_ATTENDANCE', points: 10, refType: 'Lesson', refId: String(lessonId), occurredAt: day(2), season: '2031-01' },
    });

    const blocked = await http().delete(`/api/lessons/${lessonId}`).set(auth(mestreToken)).expect(409);
    assert.equal(blocked.body.attendances, 1);
    assert.equal(await prisma.lesson.count({ where: { id: lessonId } }), 1);
    assert.equal(await prisma.attendance.count({ where: { lessonId } }), 1);

    await http().delete(`/api/lessons/${lessonId}?confirm=true`).set(auth(mestreToken)).expect(200);
    assert.equal(await prisma.lesson.count({ where: { id: lessonId } }), 0);
    assert.equal(await prisma.attendance.count({ where: { lessonId } }), 0);
    // Ginga Rank e' derivado: o recalculo agendado remove o PointEvent orfao (fire-and-forget => espera ate 5 s).
    let points = 1;
    for (let i = 0; i < 25 && points > 0; i += 1) {
      points = await prisma.pointEvent.count({ where: { studentId, refType: 'Lesson', refId: String(lessonId) } });
      if (points > 0) await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(points, 0);
  });

  it('POST /lessons/bulk-delete: dryRun conta; apaga so as CANCELADAS da turma (ativas e de outra turma intactas); sem criterio => 400', async () => {
    const classId = await newClass('lote');
    const otherClassId = await newClass('lote outra');
    const cancelled = [await newLesson(classId, 10, 'INACTIVE'), await newLesson(classId, 11, 'INACTIVE')];
    const active = await newLesson(classId, 12, 'ACTIVE');
    const otherCancelled = await newLesson(otherClassId, 10, 'INACTIVE');

    await http().post('/api/lessons/bulk-delete').set(auth(mestreToken)).send({ classId }).expect(400);
    const dry = await http().post('/api/lessons/bulk-delete').set(auth(mestreToken)).send({ classId, onlyCancelled: true, dryRun: true }).expect(200);
    assert.deepEqual({ lessons: dry.body.lessons, deleted: dry.body.deleted }, { lessons: 2, deleted: false });
    assert.equal(await prisma.lesson.count({ where: { classId } }), 3);

    const res = await http().post('/api/lessons/bulk-delete').set(auth(mestreToken)).send({ classId, onlyCancelled: true }).expect(200);
    assert.equal(res.body.lessons, 2);
    assert.equal(res.body.deleted, true);
    assert.equal(await prisma.lesson.count({ where: { id: { in: cancelled } } }), 0);
    assert.equal(await prisma.lesson.count({ where: { id: { in: [active, otherCancelled] } } }), 2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'LESSON_DELETE_BULK' }, orderBy: { id: 'desc' } });
    assert.equal((audit.metadata as { count: number }).count, 2);

    // ids: aula ATIVA nunca e apagada por aqui (vira skipped)
    const byIds = await http().post('/api/lessons/bulk-delete').set(auth(mestreToken)).send({ ids: [active, otherCancelled] }).expect(200);
    assert.equal(byIds.body.lessons, 1);
    assert.equal(byIds.body.skipped, 1);
    assert.equal(await prisma.lesson.count({ where: { id: active } }), 1);
  });

  it('PROFESSOR, ALUNO e o Mestre de OUTRO grupo nao apagam (403/403/404) e nada some', async () => {
    const classId = await newClass('rbac');
    const lessonId = await newLesson(classId, 20, 'INACTIVE');
    for (const token of [professorToken, alunoToken]) {
      await http().delete(`/api/lessons/${lessonId}`).set(auth(token)).expect(403);
      await http().post('/api/lessons/bulk-delete').set(auth(token)).send({ onlyCancelled: true }).expect(403);
      await http().delete(`/api/classes/${classId}`).set(auth(token)).expect(403);
      await http().get(`/api/classes/${classId}/delete-impact`).set(auth(token)).expect(403);
    }
    await http().delete(`/api/lessons/${lessonId}`).set(auth(other.token)).expect(404);
    await http().delete(`/api/classes/${classId}`).set(auth(other.token)).expect(404);
    assert.equal(await prisma.lesson.count({ where: { id: lessonId } }), 1);
    assert.equal(await prisma.class.count({ where: { id: classId } }), 1);
  });

  it('turma: delete-impact conta; DELETE sem confirm => 409; com confirm apaga aulas, presencas e vinculos, mas NAO o aluno', async () => {
    const classId = await newClass('apagar turma');
    const studentId = await newStudent('aluno da turma apagada');
    await prisma.classStudent.create({ data: { organizationId: orgId, classId, studentId } });
    const l1 = await newLesson(classId, 30);
    await newLesson(classId, 31, 'INACTIVE');
    await prisma.attendance.create({ data: { organizationId: orgId, lessonId: l1, studentId, present: true } });

    const impact = await http().get(`/api/classes/${classId}/delete-impact`).set(auth(mestreToken)).expect(200);
    assert.equal(impact.body.lessons, 2);
    assert.equal(impact.body.attendances, 1);
    assert.equal(impact.body.students, 1);
    assert.equal(impact.body.class.id, classId);

    const blocked = await http().delete(`/api/classes/${classId}`).set(auth(mestreToken)).expect(409);
    assert.deepEqual([blocked.body.lessons, blocked.body.attendances, blocked.body.students], [2, 1, 1]);
    assert.equal(await prisma.class.count({ where: { id: classId } }), 1);

    await http().delete(`/api/classes/${classId}?confirm=true`).set(auth(mestreToken)).expect(200);
    assert.equal(await prisma.class.count({ where: { id: classId } }), 0);
    assert.equal(await prisma.lesson.count({ where: { classId } }), 0);
    assert.equal(await prisma.classStudent.count({ where: { classId } }), 0);
    assert.equal(await prisma.attendance.count({ where: { lessonId: l1 } }), 0);
    assert.equal(await prisma.student.count({ where: { id: studentId } }), 1); // a pessoa/matricula no grupo continua
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: 'CLASS_DELETE', resourceId: String(classId) } });
    assert.equal((audit.metadata as { lessons: number }).lessons, 2);
  });

  it('turma vazia (sem aulas nem presencas) apaga sem confirm', async () => {
    const classId = await newClass('vazia');
    await http().delete(`/api/classes/${classId}`).set(auth(mestreToken)).expect(200);
    assert.equal(await prisma.class.count({ where: { id: classId } }), 0);
  });

  it('GET /classes/:id/students traz nome, apelido, corda atual e frequencia (contagem e %) na turma', async () => {
    const classId = await newClass('alunos');
    const present = await newStudent('presente');
    const absent = await newStudent('ausente');
    for (const studentId of [present, absent]) await prisma.classStudent.create({ data: { organizationId: orgId, classId, studentId } });
    // 4 aulas ativas ja realizadas nos ultimos 90 dias; o aluno "presente" foi a 3 delas
    const now = Date.now();
    const past = [5, 10, 15, 20].map((d) => new Date(now - d * 86400000));
    const lessons: number[] = [];
    for (const date of past) lessons.push((await prisma.lesson.create({ data: { organizationId: orgId, classId, date } })).id);
    for (const lessonId of lessons.slice(0, 3)) await prisma.attendance.create({ data: { organizationId: orgId, lessonId, studentId: present, present: true } });
    await prisma.attendance.create({ data: { organizationId: orgId, lessonId: lessons[3], studentId: present, present: false } });

    const res = await http().get(`/api/classes/${classId}/students`).set(auth(mestreToken)).expect(200);
    assert.equal(res.body.length, 2);
    const row = res.body.find((r: { studentId: number }) => r.studentId === present);
    const none = res.body.find((r: { studentId: number }) => r.studentId === absent);
    assert.match(row.name, /presente/);
    assert.equal(row.presences, 3);
    assert.equal(row.lessonsInPeriod, 4);
    assert.equal(row.attendanceRate, 75);
    assert.equal(row.currentCord, null);
    assert.equal(none.presences, 0);
    assert.equal(none.attendanceRate, 0);
    for (const key of ['nickname', 'photo', 'studentStatus', 'enrolledAt', 'presencesTotal']) assert.ok(key in row, key);
  });
});
