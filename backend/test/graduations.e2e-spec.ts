import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Graduações (graduations.service.ts / .controller.ts) tem dois níveis: configuração de
 * sistema/nível de graduação (systems/levels — recurso do grupo) e histórico por aluno
 * (students/:studentId). Reaproveita a Ana Capoeirista do seed de dev como aluna de teste.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';
const NONEXISTENT_SYSTEM_ID = 999999;

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { id: number; organizationId: number } };
}

describe('Graduations (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let anaStudentId: number;

  let testSystemId: number;
  let testLevelId: number;
  let testGraduationId: number;

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
  });

  after(async () => {
    // Limpa na ordem inversa das FKs: graduação do aluno -> nível -> sistema.
    if (testGraduationId) {
      await prisma.studentGraduation.deleteMany({ where: { id: testGraduationId } });
    }
    if (testLevelId) {
      await prisma.graduationLevel.deleteMany({ where: { id: testLevelId } });
    }
    if (testSystemId) {
      await prisma.graduationSystem.deleteMany({ where: { id: testSystemId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /graduations/systems cria um sistema de graduação — 201, e existe de verdade no banco', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/graduations/systems')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: 'Sistema E2E Teste', description: 'Sistema criado pelo teste e2e' })
      .expect(201);

    testSystemId = res.body.id;

    const persisted = await prisma.graduationSystem.findUnique({ where: { id: testSystemId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.name, 'Sistema E2E Teste');
    assert.equal(persisted?.organizationId, organizationId);
  });

  it('POST /graduations/systems/:systemId/levels cria um nível — 201, e existe de verdade no banco', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/graduations/systems/${testSystemId}/levels`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: 'Nível E2E', order: 1, color: '#123456' })
      .expect(201);

    testLevelId = res.body.id;

    const persisted = await prisma.graduationLevel.findUnique({ where: { id: testLevelId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.name, 'Nível E2E');
    assert.equal(persisted?.graduationSystemId, testSystemId);
  });

  it('POST /graduations/systems/:systemId/levels com systemId inexistente — 404', async () => {
    await request(app.getHttpServer())
      .post(`/api/graduations/systems/${NONEXISTENT_SYSTEM_ID}/levels`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ name: 'Nível órfão', order: 1 })
      .expect(404);
  });

  it('POST /graduations/students/:studentId registra uma graduação — 201, e existe de verdade no banco', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/graduations/students/${anaStudentId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ graduationLevelId: testLevelId, graduatedAt: new Date().toISOString(), notes: 'Graduação do teste e2e' })
      .expect(201);

    testGraduationId = res.body.id;

    const persisted = await prisma.studentGraduation.findUnique({ where: { id: testGraduationId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, anaStudentId);
    assert.equal(persisted?.graduationLevelId, testLevelId);
  });

  it('GET /graduations/students/:studentId retorna o histórico com a graduação recém-criada e graduationLevel populado', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/graduations/students/${anaStudentId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const entry = res.body.find((g: { id: number }) => g.id === testGraduationId);
    assert.ok(entry, 'a graduação criada neste teste deveria aparecer no histórico da Ana');
    assert.ok(entry.graduationLevel, 'graduationLevel deveria vir populado (include no service)');
    assert.equal(entry.graduationLevel.id, testLevelId);
    assert.equal(entry.graduationLevel.name, 'Nível E2E');
  });

  it('ALUNO não pode criar sistema de graduação (canCreate=false na matriz) — 403', async () => {
    await request(app.getHttpServer())
      .post('/api/graduations/systems')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ name: 'Sistema que o aluno não deveria conseguir criar' })
      .expect(403);
  });
});
