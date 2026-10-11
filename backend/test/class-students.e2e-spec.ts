import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { ALUNO_EMAIL, MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { createOtherOrg, deleteOtherOrg } from './utils/page-helpers';

/**
 * Matrícula de alunos em turmas via API: GET/POST /classes/:id/students e
 * DELETE /classes/:id/students/:studentId (classes.service). POST é idempotente e reativa
 * matrícula INACTIVE; aluno de outra org => 400; turma de outra org => 404; DELETE marca INACTIVE.
 * O roster de GET /attendance/lessons/:id passa a listar o aluno matriculado pela API.
 * Fixtures prefixadas com a tag, apagadas no after() (ordem das FKs).
 */
describe('Matrícula em turma (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let otherOrgId: number;
  let classId: number;
  let otherClassId: number;
  let studentId: number;
  let otherOrgStudentId: number;
  let lessonId: number;
  const tag = `[e2e-class-students-${Date.now()}]`;

  const url = (suffix = '') => `/api/classes/${classId}/students${suffix}`;
  const enrollments = () => prisma.classStudent.findMany({ where: { classId, studentId } });

  before(async () => {
    app = await createTestApp();
    const mestre = await loginAs(app, MESTRE_EMAIL);
    mestreToken = mestre.token;
    orgId = mestre.organizationId;
    alunoToken = (await loginAs(app, ALUNO_EMAIL)).token;
    otherOrgId = await createOtherOrg(prisma, 'class-students');
    classId = (await prisma.class.create({ data: { organizationId: orgId, name: `${tag} turma` } })).id;
    otherClassId = (await prisma.class.create({ data: { organizationId: otherOrgId, name: `${tag} alheia` } })).id;
    studentId = (await prisma.student.create({ data: { organizationId: orgId, name: `${tag} aluno` } })).id;
    otherOrgStudentId = (await prisma.student.create({ data: { organizationId: otherOrgId, name: `${tag} alheio` } })).id;
    lessonId = (await prisma.lesson.create({ data: { organizationId: orgId, classId, date: new Date() } })).id;
  });

  after(async () => {
    await prisma.attendance.deleteMany({ where: { lessonId } });
    await prisma.lesson.deleteMany({ where: { classId } });
    await prisma.classStudent.deleteMany({ where: { classId: { in: [classId, otherClassId] } } });
    await prisma.class.deleteMany({ where: { id: { in: [classId, otherClassId] } } });
    await prisma.student.deleteMany({ where: { id: { in: [studentId, otherOrgStudentId] } } });
    await deleteOtherOrg(prisma, otherOrgId);
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /classes/:id/students de turma sem matrículas => 200 e []', async () => {
    const res = await request(app.getHttpServer()).get(url()).set('Authorization', `Bearer ${mestreToken}`).expect(200);
    assert.deepEqual(res.body, []);
  });

  it('POST matricula (201), persiste ACTIVE e aparece no GET e no roster da aula (present: null)', async () => {
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({ studentId }).expect(201);
    const rows = await enrollments();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'ACTIVE');
    assert.equal(rows[0].organizationId, orgId);

    const list = await request(app.getHttpServer()).get(url()).set('Authorization', `Bearer ${mestreToken}`).expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].studentId, studentId);
    assert.equal(list.body[0].name, `${tag} aluno`);

    const roster = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
    const entry = roster.body.find((e: { studentId: number }) => e.studentId === studentId);
    assert.ok(entry, 'aluno matriculado via API deve aparecer no roster');
    assert.equal(entry.present, null);
  });

  it('POST repetido é idempotente: continua 1 registro só (sem duplicar, sem erro)', async () => {
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({ studentId }).expect(201);
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({ studentId }).expect(201);
    assert.equal((await enrollments()).length, 1);
  });

  it('DELETE marca INACTIVE (registro mantido), some do GET e do roster', async () => {
    await request(app.getHttpServer()).delete(url(`/${studentId}`)).set('Authorization', `Bearer ${mestreToken}`).expect(200);
    const rows = await enrollments();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'INACTIVE');

    const list = await request(app.getHttpServer()).get(url()).set('Authorization', `Bearer ${mestreToken}`).expect(200);
    assert.deepEqual(list.body, []);
    const roster = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);
    assert.ok(!roster.body.some((e: { studentId: number }) => e.studentId === studentId));
  });

  it('POST depois do DELETE reativa a mesma matrícula (mesmo id, ACTIVE, ainda 1 registro)', async () => {
    const previous = (await enrollments())[0];
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({ studentId }).expect(201);
    const rows = await enrollments();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, previous.id);
    assert.equal(rows[0].status, 'ACTIVE');
  });

  it('DELETE de aluno sem matrícula na turma => 404', async () => {
    await request(app.getHttpServer()).delete(url(`/${otherOrgStudentId}`)).set('Authorization', `Bearer ${mestreToken}`).expect(404);
  });

  it('POST com aluno de outra organização => 400 e nada é gravado', async () => {
    const res = await request(app.getHttpServer())
      .post(url())
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: otherOrgStudentId })
      .expect(400);
    assert.equal(res.body.message, 'Aluno inválido para esta organização.');
    assert.equal(await prisma.classStudent.count({ where: { studentId: otherOrgStudentId } }), 0);
  });

  it('turma de outra organização => 404 em GET, POST e DELETE (nada gravado)', async () => {
    const base = `/api/classes/${otherClassId}/students`;
    await request(app.getHttpServer()).get(base).set('Authorization', `Bearer ${mestreToken}`).expect(404);
    await request(app.getHttpServer()).post(base).set('Authorization', `Bearer ${mestreToken}`).send({ studentId }).expect(404);
    await request(app.getHttpServer()).delete(`${base}/${studentId}`).set('Authorization', `Bearer ${mestreToken}`).expect(404);
    assert.equal(await prisma.classStudent.count({ where: { classId: otherClassId } }), 0);
  });

  it('validação e RBAC: studentId ausente/inválido => 400; ALUNO 403 (view e edit); sem token 401', async () => {
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({}).expect(400);
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${mestreToken}`).send({ studentId: 'x' }).expect(400);
    await request(app.getHttpServer()).get(url()).set('Authorization', `Bearer ${alunoToken}`).expect(403);
    await request(app.getHttpServer()).post(url()).set('Authorization', `Bearer ${alunoToken}`).send({ studentId }).expect(403);
    await request(app.getHttpServer()).delete(url(`/${studentId}`)).set('Authorization', `Bearer ${alunoToken}`).expect(403);
    await request(app.getHttpServer()).get(url()).expect(401);
  });
});
