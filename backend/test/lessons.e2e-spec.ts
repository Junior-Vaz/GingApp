import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * CRUD de Aulas (Lesson, src/interface/http/lessons/) — mesmo padrão de classes.e2e-spec.ts.
 * `teacherUserId` não é FK para uma tabela Teacher (não existe): é o User.id de alguém com
 * membership MESTRE/PROFESSOR na organização (lessons.service.ts). Para testar o caminho
 * inválido, buscamos direto via Prisma o id do usuário aluno@ (que não é MESTRE/PROFESSOR) —
 * não há endpoint que exponha esse id de forma mais direta que consultar o banco.
 *
 * Reaproveita a turma do seed ("Adulto — Quinta 19h") como classId válido — é a mesma em que
 * Ana (aluno@) está matriculada, usada também no teste de GET /lessons/me. Fixtures desta
 * suíte são prefixadas com "[e2e-lessons]" (nas notes) e apagadas no after().
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const SEED_CLASS_NAME = 'Adulto — Quinta 19h';

async function loginFull(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { organizationId: number } };
}

describe('Lessons CRUD (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let seedClassId: number;
  let alunoUserId: number;
  let professorUserId: number;
  const createdLessonIds: number[] = [];

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await loginFull(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    alunoToken = (await loginFull(app, ALUNO_EMAIL)).accessToken;

    const seedClass = await prisma.class.findFirstOrThrow({
      where: { organizationId, name: SEED_CLASS_NAME },
    });
    seedClassId = seedClass.id;

    const alunoUser = await prisma.user.findUniqueOrThrow({ where: { email: ALUNO_EMAIL } });
    alunoUserId = alunoUser.id;

    const professorUser = await prisma.user.findUniqueOrThrow({ where: { email: PROFESSOR_EMAIL } });
    professorUserId = professorUser.id;
  });

  after(async () => {
    // Limpa só as fixtures criadas por esta suíte — nunca mexe na turma/aula do seed.
    if (createdLessonIds.length > 0) {
      await prisma.lesson.deleteMany({ where: { id: { in: createdLessonIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /lessons com classId do seed e sem professor cria a aula de verdade', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 7 * 86400000).toISOString(), notes: '[e2e-lessons] sem professor' })
      .expect(201);

    createdLessonIds.push(res.body.id);

    const persisted = await prisma.lesson.findUnique({ where: { id: res.body.id } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.classId, seedClassId);
    assert.equal(persisted?.teacherUserId, null);
  });

  it('POST /lessons com classId inexistente retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.lesson.count();

    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: 999999, date: new Date().toISOString() })
      .expect(400);

    assert.equal(res.body.message, 'Turma inválida para esta organização.');

    assert.equal(await prisma.lesson.count(), beforeCount);
  });

  it('POST /lessons com teacherUserId de quem não é MESTRE/PROFESSOR retorna 400 e nada é gravado', async () => {
    const beforeCount = await prisma.lesson.count();

    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, teacherUserId: alunoUserId, date: new Date().toISOString() })
      .expect(400);

    assert.equal(res.body.message, 'Professor inválido para esta organização.');

    assert.equal(await prisma.lesson.count(), beforeCount);
  });

  it('POST /lessons com teacherUserId válido (professor@) retorna 201 e persiste o vínculo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        classId: seedClassId,
        teacherUserId: professorUserId,
        date: new Date(Date.now() + 8 * 86400000).toISOString(),
        notes: '[e2e-lessons] com professor',
      })
      .expect(201);

    createdLessonIds.push(res.body.id);

    const persisted = await prisma.lesson.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(persisted.teacherUserId, professorUserId);
  });

  it('DELETE /lessons/:id é soft delete — status vira INACTIVE, registro nunca some', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 9 * 86400000).toISOString(), notes: '[e2e-lessons] para remover' })
      .expect(201);
    createdLessonIds.push(created.body.id);

    await request(app.getHttpServer())
      .delete(`/api/lessons/${created.body.id}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.lesson.findUniqueOrThrow({ where: { id: created.body.id } });
    assert.ok(persisted !== null); // continua existindo — nunca é apagada de verdade
    assert.equal(persisted.status, 'INACTIVE');
  });

  it('GET /lessons/me logado como aluno inclui a aula da turma em que ele está matriculado', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/lessons')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ classId: seedClassId, date: new Date(Date.now() + 10 * 86400000).toISOString(), notes: '[e2e-lessons] para /me' })
      .expect(201);
    createdLessonIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .get('/api/lessons/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.some((l: { id: number }) => l.id === created.body.id));
  });
});
