import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { ALUNO_EMAIL, MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Certificado em PDF (GET /certificates/:id/pdf e GET /public/certificates/:code/pdf). Reaproveita a Ana do
 * seed (aluno@gingabrasil.com.br) e cria fixtures próprias ("[e2e-certpdf]"), removidas no after().
 */
function binary(res: NodeJS.ReadableStream, cb: (err: Error | null, body?: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Certificado em PDF (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let anaCertificate: { id: number; verificationCode: string };
  let otherCertificate: { id: number; verificationCode: string };
  const certificateIds: number[] = [];
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const getPdf = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path).buffer(true).parse(binary);
    return token ? req.set(auth(token)) : req;
  };

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE_EMAIL);
    aluno = await loginAs(app, ALUNO_EMAIL);
    orgB = await createSecondOrg(app, prisma, 'certpdf');

    const ana = await prisma.student.findFirstOrThrow({ where: { organizationId: mestre.organizationId, name: 'Ana Capoeirista' } });
    const graduation = await prisma.studentGraduation.findFirstOrThrow({ where: { organizationId: mestre.organizationId, studentId: ana.id } });
    const other = await prisma.student.create({ data: { organizationId: mestre.organizationId, name: '[e2e-certpdf] Outro Aluno' } });

    const make = async (studentId: number, title: string, studentGraduationId?: number) => {
      const res = await request(app.getHttpServer())
        .post('/api/certificates')
        .set(auth(mestre.token))
        .send({ studentId, title, studentGraduationId })
        .expect(201);
      certificateIds.push(res.body.id);
      return res.body as { id: number; verificationCode: string };
    };
    anaCertificate = await make(ana.id, '[e2e-certpdf] Graduação à Corda Azul — João Çedilha', graduation.id);
    otherCertificate = await make(other.id, '[e2e-certpdf] Certificado do outro');
  });

  after(async () => {
    await prisma.certificate.deleteMany({ where: { id: { in: certificateIds } } });
    await prisma.student.deleteMany({ where: { name: { startsWith: '[e2e-certpdf]' } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('Mestre baixa o PDF (começa com %PDF, termina com %%EOF, anexo com o código no nome)', async () => {
    const res = await getPdf(`/api/certificates/${anaCertificate.id}/pdf`, mestre.token).expect(200);
    assert.match(res.headers['content-type'], /application\/pdf/);
    assert.match(res.headers['content-disposition'], new RegExp(`certificado-${anaCertificate.verificationCode}\\.pdf`));
    const body = res.body as Buffer;
    assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(body.length > 2000, `PDF com conteúdo (${body.length} bytes)`);
    assert.ok(body.subarray(-16).toString('latin1').includes('%%EOF'));
  });

  it('o próprio aluno baixa o seu PDF; o de outro aluno do mesmo grupo é 404', async () => {
    const own = await getPdf(`/api/certificates/${anaCertificate.id}/pdf`, aluno.token).expect(200);
    assert.equal((own.body as Buffer).subarray(0, 5).toString('latin1'), '%PDF-');
    await getPdf(`/api/certificates/${otherCertificate.id}/pdf`, aluno.token).expect(404);
  });

  it('isolamento: Mestre de OUTRO grupo recebe 404; sem token = 401', async () => {
    await getPdf(`/api/certificates/${anaCertificate.id}/pdf`, orgB.token).expect(404);
    await getPdf(`/api/certificates/${anaCertificate.id}/pdf`).expect(401);
  });

  it('PDF público por código de verificação (sem token); código inexistente = 404', async () => {
    const res = await getPdf(`/api/public/certificates/${anaCertificate.verificationCode}/pdf`).expect(200);
    assert.equal((res.body as Buffer).subarray(0, 5).toString('latin1'), '%PDF-');
    await getPdf('/api/public/certificates/codigo-que-nao-existe/pdf').expect(404);
  });
});
