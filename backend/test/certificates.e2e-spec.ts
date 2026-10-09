import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { ALUNO_EMAIL as ALUNO, MESTRE_EMAIL as MESTRE, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

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

/** Paginação + filtros, limpar campos no PATCH e RBAC de GET /certificates. */
describe('Certificados — lista paginada e limpar campos (e2e)', () => {
  const TAG = `B2CERT${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let anaId: number;
  let outroId: number;
  let studentBId: number;
  const get = (path: string, token = mestre.token) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: number, body: object) =>
    request(app.getHttpServer()).patch(`/api/certificates/${id}`).set('Authorization', `Bearer ${mestre.token}`).send(body);

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    orgB = await createSecondOrg(app, prisma, 'cert');
    anaId = (await prisma.student.findFirstOrThrow({ where: { organizationId: mestre.organizationId, user: { email: ALUNO } } })).id;
    outroId = (await prisma.student.create({ data: { organizationId: mestre.organizationId, name: `${TAG} Aluno Zeta` } })).id;
    studentBId = (await prisma.student.create({ data: { organizationId: orgB.organizationId, name: `${TAG} Aluno B` } })).id;

    // 55 certificados: 10 do "outro" aluno (i<10), o resto da Ana; emissão em 2033-01-(1+i) ; título marcado nos pares.
    await prisma.certificate.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: mestre.organizationId,
        studentId: i < 10 ? outroId : anaId,
        title: i % 2 === 0 ? `${TAG} diploma par ${i}` : `${TAG} certificado ${i}`,
        issuedAt: new Date(Date.UTC(2033, 0, 1 + i)),
        verificationCode: `${TAG}-code-${i}`,
      })),
    });
    await prisma.certificate.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: orgB.organizationId,
        studentId: studentBId,
        title: `${TAG} orgB ${i}`,
        issuedAt: new Date(Date.UTC(2033, 0, 1)),
        verificationCode: `${TAG}-codeB-${i}`,
      })),
    });
  });

  after(async () => {
    await prisma.certificate.deleteMany({ where: { title: { startsWith: TAG } } });
    await prisma.student.deleteMany({ where: { id: { in: [outroId, studentBId] } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem limit: array de 50 (antes era sem limite) e X-Total-Count real; limit/offset fatiam (id desc)', async () => {
    const res = await get('/certificates').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], String(await prisma.certificate.count({ where: { organizationId: mestre.organizationId } })));
    assert.ok(res.body[0].student?.name, 'itens mantêm o include de student');
    const all = await prisma.certificate.findMany({ where: { organizationId: mestre.organizationId, title: { startsWith: TAG } }, orderBy: { id: 'desc' } });
    const page = await get(`/certificates?q=${TAG}&limit=10&offset=50`).expect(200);
    assert.equal(page.headers['x-total-count'], '55');
    assert.deepEqual(page.body.map((c: { id: number }) => c.id), all.slice(50).map((c) => c.id));
  });

  it('limit=201, limit=0, offset=-1, studentId inválido, from inválido e parâmetro desconhecido => 400', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'studentId=x', 'from=ontem', 'foo=1']) await get(`/certificates?${qs}`).expect(400);
  });

  it('filtros: studentId, from/to de emissão (inclusivos) e q (título, código, nome do aluno)', async () => {
    assert.equal((await get(`/certificates?q=${TAG}&studentId=${outroId}`).expect(200)).headers['x-total-count'], '10');
    assert.equal((await get(`/certificates?q=${TAG}&studentId=${anaId}`).expect(200)).headers['x-total-count'], '45');
    assert.equal((await get(`/certificates?q=${TAG}&from=2033-01-10&to=2033-01-12`).expect(200)).headers['x-total-count'], '3');
    assert.equal((await get(`/certificates?q=${TAG}&to=2033-01-01`).expect(200)).headers['x-total-count'], '1');
    assert.equal((await get(`/certificates?q=${TAG}%20DIPLOMA`).expect(200)).headers['x-total-count'], '28'); // título, caixa ignorada
    assert.equal((await get(`/certificates?q=${TAG}-code-7`).expect(200)).headers['x-total-count'], '1'); // código de verificação
    assert.equal((await get(`/certificates?q=${TAG}%20Aluno%20Zeta`).expect(200)).headers['x-total-count'], '10'); // nome do aluno
  });

  it('total NÃO inclui outra organização', async () => {
    assert.equal((await get(`/certificates?q=${TAG}`).expect(200)).headers['x-total-count'], '55');
    assert.equal((await get(`/certificates?q=${TAG}`, orgB.token).expect(200)).headers['x-total-count'], '3');
    assert.equal((await get(`/certificates?q=${TAG}%20Aluno%20B`).expect(200)).headers['x-total-count'], '0'); // aluno da org B invisível
  });

  it('PATCH fileUrl=null limpa o arquivo (2ª via: Prisma); fileUrl vazio continua 400', async () => {
    const c = await prisma.certificate.create({
      data: { organizationId: mestre.organizationId, studentId: anaId, title: `${TAG} limpar`, issuedAt: new Date(), fileUrl: 'https://exemplo.com/c.pdf' },
    });
    await patch(c.id, { fileUrl: null }).expect(200);
    assert.equal((await prisma.certificate.findUniqueOrThrow({ where: { id: c.id } })).fileUrl, null);
    await patch(c.id, { fileUrl: '' }).expect(400);
  });

  it('null em campo OBRIGATÓRIO => 400 (title, issuedAt) e nada muda', async () => {
    const c = await prisma.certificate.create({
      data: { organizationId: mestre.organizationId, studentId: anaId, title: `${TAG} obrig`, issuedAt: new Date() },
    });
    for (const body of [{ title: null }, { issuedAt: null }]) await patch(c.id, body).expect(400);
    const db = await prisma.certificate.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(db.title, `${TAG} obrig`);
    assert.ok(db.issuedAt);
  });

  it('RBAC inalterado: sem token 401; ALUNO 403 em GET /certificates (usa /me)', async () => {
    await request(app.getHttpServer()).get('/api/certificates').expect(401);
    await get('/certificates', aluno.token).expect(403);
    await get('/certificates/me', aluno.token).expect(200);
  });
});