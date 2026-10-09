import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Passaporte do Capoeirista (src/interface/http/passport/), Jornada do Capoeirista parte 2 —
 * PLANO_PROJETO.md §10.16. Reaproveita a fixture do seed que já modela exatamente o caso mais
 * importante: Ana Capoeirista é menor de idade (birthDate 2014), com um StudentGuardian
 * (responsavel@gingabrasil.com.br) criado com `consentPublicProfile: false` por padrão — ou
 * seja, o cenário "responsável ainda não autorizou" já vem pronto do seed, não precisa ser
 * construído aqui.
 *
 * `after()` restaura o estado documentado do seed (`consentPublicProfile: false`, nenhum
 * `PublicProfile` para a Ana) para não deixar a suíte mudar dado de fixture compartilhado.
 */
const DEV_PASSWORD = 'Dev@12345';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br'; // Ana Capoeirista, menor de idade
const RESPONSAVEL_EMAIL = 'responsavel@gingabrasil.com.br'; // mãe da Ana, StudentGuardian
const PROFESSOR_EMAIL = 'professor@gingabrasil.com.br'; // sem vínculo de guardian com a Ana

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

describe('Passaporte do Capoeirista (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let alunoToken: string;
  let responsavelToken: string;
  let responsavelUserId: number;
  let professorToken: string;
  let organizationId: number;
  let anaStudentId: number;

  before(async () => {
    app = await createTestApp();

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;
    organizationId = alunoLogin.user.organizationId;
    const responsavelLogin = await login(app, RESPONSAVEL_EMAIL);
    responsavelToken = responsavelLogin.accessToken;
    responsavelUserId = responsavelLogin.user.id;
    professorToken = (await login(app, PROFESSOR_EMAIL)).accessToken;

    const ana = await prisma.student.findFirstOrThrow({ where: { organizationId, name: 'Ana Capoeirista' } });
    anaStudentId = ana.id;
  });

  after(async () => {
    await prisma.publicProfile.deleteMany({ where: { studentId: anaStudentId } });
    await prisma.studentGuardian.updateMany({
      where: { studentId: anaStudentId },
      data: { consentPublicProfile: false },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /passport/me como ALUNO retorna estatísticas conferidas via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/passport/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    assert.equal(res.body.student.name, 'Ana Capoeirista');
    assert.equal(res.body.organization.name, 'Grupo Ginga Brasil');
    assert.equal(res.body.publicProfile, null);

    const [aulas, graduacoes, certificados] = await Promise.all([
      prisma.attendance.count({ where: { organizationId, studentId: anaStudentId, present: true } }),
      prisma.studentGraduation.count({ where: { organizationId, studentId: anaStudentId } }),
      prisma.certificate.count({ where: { organizationId, studentId: anaStudentId } }),
    ]);
    assert.equal(res.body.stats.aulas, aulas);
    assert.equal(res.body.stats.graduacoes, graduacoes);
    assert.equal(res.body.stats.certificados, certificados);
  });

  it('GET /passport/me como ALUNO menor: viewer diz que não pode publicar nem autorizar (UI não oferece o botão)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/passport/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    assert.deepEqual(res.body.viewer, {
      isGuardian: false,
      isMinor: true,
      hasConsent: null,
      canPublish: false,
      canConsent: false,
    });
  });

  it('GET /passport/me como RESPONSÁVEL sem consentimento: pode autorizar, ainda não pode publicar', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/passport/me')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .expect(200);
    assert.deepEqual(res.body.viewer, {
      isGuardian: true,
      isMinor: true,
      hasConsent: false,
      canPublish: false,
      canConsent: true,
    });
  });

  it('POST /passport/publish como o PRÓPRIO ALUNO (menor de idade) → 403, sem responsável não pode', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/passport/publish')
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: anaStudentId })
      .expect(403);
    assert.match(res.body.message, /menor de idade/);

    const profile = await prisma.publicProfile.findUnique({ where: { studentId: anaStudentId } });
    assert.equal(profile, null);
  });

  it('POST /passport/publish como PROFESSOR (sem vínculo de guardian) → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/passport/publish')
      .set('Authorization', `Bearer ${professorToken}`)
      .send({ studentId: anaStudentId })
      .expect(403);
  });

  it('POST /passport/publish como RESPONSÁVEL sem consentimento (padrão do seed) → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/passport/publish')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .send({ studentId: anaStudentId })
      .expect(400);
    assert.match(res.body.message, /autorize/);
  });

  it('PATCH /passport/guardian-consent como RESPONSÁVEL autoriza, confirmado via Prisma', async () => {
    await request(app.getHttpServer())
      .patch('/api/passport/guardian-consent')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .send({ studentId: anaStudentId, consent: true })
      .expect(200);

    const guardian = await prisma.studentGuardian.findFirstOrThrow({
      where: { studentId: anaStudentId, userId: responsavelUserId },
    });
    assert.equal(guardian.consentPublicProfile, true);
  });

  it('POST /passport/publish como RESPONSÁVEL, já com consentimento → 201, publicCode gerado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/passport/publish')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .send({ studentId: anaStudentId })
      .expect(201);

    assert.equal(res.body.isPublished, true);
    assert.ok(typeof res.body.publicCode === 'string' && res.body.publicCode.length > 10);

    const profile = await prisma.publicProfile.findUniqueOrThrow({ where: { studentId: anaStudentId } });
    assert.equal(profile.isPublished, true);
    assert.equal(profile.consentByGuardianId !== null, true);
  });

  it('GET /passport/me como RESPONSÁVEL com consentimento: viewer libera publicar', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/passport/me')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .expect(200);
    assert.equal(res.body.viewer.hasConsent, true);
    assert.equal(res.body.viewer.canPublish, true);
  });

  it('GET /public/passport/:code SEM token retorna o passaporte público', async () => {
    const profile = await prisma.publicProfile.findUniqueOrThrow({ where: { studentId: anaStudentId } });

    const res = await request(app.getHttpServer()).get(`/api/public/passport/${profile.publicCode}`).expect(200);

    assert.equal(res.body.student.name, 'Ana Capoeirista');
    assert.equal(res.body.organization.name, 'Grupo Ginga Brasil');
    assert.ok(res.body.stats);
    // viewer revela menoridade/vínculo de quem consulta: NUNCA pode vazar no endpoint público.
    assert.equal(res.body.viewer, undefined);
  });

  it('GET /public/passport/:code com código inválido → 404', async () => {
    await request(app.getHttpServer()).get('/api/public/passport/codigo-que-nao-existe').expect(404);
  });

  it('GET /passport/me agora reflete isPublished=true e o publicCode', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/passport/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    assert.equal(res.body.publicProfile.isPublished, true);
    assert.ok(typeof res.body.publicProfile.publicCode === 'string');
  });

  it('POST /passport/unpublish como RESPONSÁVEL → some da verificação pública', async () => {
    const profile = await prisma.publicProfile.findUniqueOrThrow({ where: { studentId: anaStudentId } });

    await request(app.getHttpServer())
      .post('/api/passport/unpublish')
      .set('Authorization', `Bearer ${responsavelToken}`)
      .send({ studentId: anaStudentId })
      .expect(201);

    await request(app.getHttpServer()).get(`/api/public/passport/${profile.publicCode}`).expect(404);
  });
});
