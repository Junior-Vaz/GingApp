import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Certificados (src/interface/http/certificates/), Fase 2 — Jornada do Capoeirista
 * (PLANO_PROJETO.md §10.15). Cobre o CRUD org-scoped (RBAC igual a "finance": ALUNO/RESPONSAVEL
 * sem `view` na listagem geral, só em `/certificates/me`) e a verificação pública por
 * `verificationCode` (rota @Public, sem token — é o que o QR Code do certificado abre).
 *
 * Reaproveita os usuários e a graduação da Ana do seed (prisma/seed.ts); fixtures próprias
 * (certificados criados aqui) são limpas no after().
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

interface LoginResult {
  accessToken: string;
  user: { id: number; organizationId: number };
}

async function login(app: INestApplication, email: string): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as LoginResult;
}

describe('Certificados (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let professorToken: string;
  let alunoToken: string;
  let organizationId: number;
  let anaStudentId: number;
  let anaGraduationId: number;

  const createdCertificateIds: number[] = [];

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;
    professorToken = (await login(app, PROFESSOR_EMAIL)).accessToken;
    alunoToken = (await login(app, ALUNO_EMAIL)).accessToken;

    const ana = await prisma.student.findFirstOrThrow({
      where: { organizationId, name: 'Ana Capoeirista' },
    });
    anaStudentId = ana.id;

    const graduation = await prisma.studentGraduation.findFirstOrThrow({
      where: { organizationId, studentId: anaStudentId },
    });
    anaGraduationId = graduation.id;
  });

  after(async () => {
    if (createdCertificateIds.length > 0) {
      await prisma.certificate.deleteMany({ where: { id: { in: createdCertificateIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /certificates (mestre) emite um certificado com graduação vinculada — confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: anaStudentId, title: '[e2e] Certificado de Graduação', studentGraduationId: anaGraduationId })
      .expect(201);
    createdCertificateIds.push(res.body.id);

    assert.ok(typeof res.body.verificationCode === 'string' && res.body.verificationCode.length > 10);

    const persisted = await prisma.certificate.findUnique({ where: { id: res.body.id } });
    assert.equal(persisted?.studentId, anaStudentId);
    assert.equal(persisted?.studentGraduationId, anaGraduationId);
    assert.equal(persisted?.verificationCode, res.body.verificationCode);
  });

  it('POST /certificates com studentId inexistente → 400, nada gravado', async () => {
    const beforeCount = await prisma.certificate.count();
    await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: 999999, title: '[e2e] Não deveria existir' })
      .expect(400);
    assert.equal(await prisma.certificate.count(), beforeCount);
  });

  it('POST /certificates com studentGraduationId que não pertence ao aluno → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: anaStudentId, title: '[e2e] Graduação inválida', studentGraduationId: 999999 })
      .expect(400);
  });

  it('GET /certificates como ALUNO → 403 (RBAC, mesmo tratamento de "finance")', async () => {
    await request(app.getHttpServer())
      .get('/api/certificates')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);
  });

  it('GET /certificates/me como ALUNO retorna o certificado da própria Ana', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/certificates/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    assert.ok(res.body.some((c: { id: number }) => c.id === createdCertificateIds[0]));
  });

  it('PATCH /certificates/:id (mestre) edita o título, confirmado via Prisma', async () => {
    await request(app.getHttpServer())
      .patch(`/api/certificates/${createdCertificateIds[0]}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ title: '[e2e] Certificado de Graduação (editado)' })
      .expect(200);

    const persisted = await prisma.certificate.findUniqueOrThrow({ where: { id: createdCertificateIds[0] } });
    assert.equal(persisted.title, '[e2e] Certificado de Graduação (editado)');
  });

  it('GET /public/certificates/:code SEM token valida o certificado, sem expor dados internos', async () => {
    const certificate = await prisma.certificate.findUniqueOrThrow({ where: { id: createdCertificateIds[0] } });

    const res = await request(app.getHttpServer())
      .get(`/api/public/certificates/${certificate.verificationCode}`)
      .expect(200);

    assert.equal(res.body.title, '[e2e] Certificado de Graduação (editado)');
    assert.equal(res.body.studentName, 'Ana Capoeirista');
    assert.equal(res.body.organizationName, 'Grupo Ginga Brasil');
    assert.equal(res.body.studentId, undefined);
    assert.equal(res.body.organizationId, undefined);
  });

  it('GET /public/certificates/:code com código inválido → 404', async () => {
    await request(app.getHttpServer()).get('/api/public/certificates/codigo-que-nao-existe').expect(404);
  });

  it('DELETE /certificates/:id como PROFESSOR → 403 (matriz padrão: PROFESSOR não tem delete)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/certificates/${createdCertificateIds[0]}`)
      .set('Authorization', `Bearer ${professorToken}`)
      .expect(403);
  });

  it('DELETE /certificates/:id como MESTRE apaga de verdade — some do banco E da verificação pública', async () => {
    const certificate = await prisma.certificate.findUniqueOrThrow({ where: { id: createdCertificateIds[0] } });

    await request(app.getHttpServer())
      .delete(`/api/certificates/${createdCertificateIds[0]}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const gone = await prisma.certificate.findUnique({ where: { id: createdCertificateIds[0] } });
    assert.equal(gone, null);
    createdCertificateIds.length = 0;

    await request(app.getHttpServer()).get(`/api/public/certificates/${certificate.verificationCode}`).expect(404);
  });
});
