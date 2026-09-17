import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Frequência (attendance.service.ts / attendance.controller.ts) é diferente do padrão CRUD
 * item-a-item dos outros módulos: é registro em LOTE por aula (roster de chamada),
 * PLANO_PROJETO.md §10.5. Reaproveita a turma/aluno do seed de dev, mas cria uma Lesson
 * própria (via Prisma direto) para não sujar aulas reais.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const INVALID_STUDENT_ID = 999999;

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { id: number; organizationId: number } };
}

describe('Attendance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let anaStudentId: number;
  let testLessonId: number;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;

    const ana = await prisma.student.findFirstOrThrow({
      where: { organizationId, user: { email: ALUNO_EMAIL } },
    });
    anaStudentId = ana.id;

    // Turma do seed em que a Ana está matriculada (prisma/seed.ts, passo 8).
    const turma = await prisma.class.findFirstOrThrow({
      where: { organizationId, name: 'Adulto — Quinta 19h' },
    });

    // Lesson de teste própria — mais simples que passar pela API, e evita sujar aulas reais.
    const lesson = await prisma.lesson.create({
      data: { organizationId, classId: turma.id, date: new Date() },
    });
    testLessonId = lesson.id;
  });

  after(async () => {
    await prisma.attendance.deleteMany({ where: { lessonId: testLessonId } });
    await prisma.lesson.delete({ where: { id: testLessonId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /attendance/lessons/:lessonId antes de registrar — cada aluno matriculado aparece com present: null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const anaEntry = res.body.find((entry: { studentId: number }) => entry.studentId === anaStudentId);
    assert.ok(anaEntry, 'Ana deveria aparecer no roster (está matriculada na turma)');
    assert.equal(anaEntry.present, null);
  });

  it('POST /attendance/lessons/:lessonId registra presença — 201, e a linha é criada de verdade no banco', async () => {
    await request(app.getHttpServer())
      .post(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send([{ studentId: anaStudentId, present: true }])
      .expect(201);

    const persisted = await prisma.attendance.findUnique({
      where: { lessonId_studentId: { lessonId: testLessonId, studentId: anaStudentId } },
    });
    assert.ok(persisted !== null);
    assert.equal(persisted?.present, true);
  });

  it('GET /attendance/lessons/:lessonId depois de registrar — agora present: true para a Ana', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const anaEntry = res.body.find((entry: { studentId: number }) => entry.studentId === anaStudentId);
    assert.equal(anaEntry.present, true);
  });

  it('POST /attendance/lessons/:lessonId com studentId inexistente — 400, e nenhuma linha nova é criada', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/attendance/lessons/${testLessonId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send([{ studentId: INVALID_STUDENT_ID, present: true }])
      .expect(400);

    assert.equal(res.body.message, 'Aluno inválido para esta organização.');

    const invalidRow = await prisma.attendance.findFirst({
      where: { lessonId: testLessonId, studentId: INVALID_STUDENT_ID },
    });
    assert.equal(invalidRow, null);
  });

  it('GET /attendance/me logado como o aluno — inclui o registro recém-criado, com last30dPercent calculado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/attendance/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body.records));
    const record = res.body.records.find((r: { lessonId: number }) => r.lessonId === testLessonId);
    assert.ok(record, 'o registro de presença criado neste teste deveria aparecer em /attendance/me');
    assert.equal(record.present, true);

    const isNumberOrNull = typeof res.body.last30dPercent === 'number' || res.body.last30dPercent === null;
    assert.ok(isNumberOrNull, `last30dPercent deveria ser number ou null, veio: ${typeof res.body.last30dPercent}`);
  });
});
