import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, MESTRE_EMAIL, loginAs } from './utils/list-helpers';

/**
 * PrismaRangeFilter (APP_FILTER): inteiro fora do range de INT4 vira 400 (antes: 500).
 */
describe('Inteiro fora de INT4 => 400 (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestreToken: string;
  let platformToken: string;
  let studentId: number;
  const tag = `[e2e-range-${Date.now()}]`;

  before(async () => {
    app = await createTestApp();
    const mestre = await loginAs(app, MESTRE_EMAIL);
    mestreToken = mestre.token;
    const res = await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: 'owner@gingapp.com.br', password: DEV_PASSWORD })
      .expect(200);
    platformToken = res.body.accessToken;
    studentId = (await prisma.student.create({ data: { organizationId: mestre.organizationId, name: `${tag} aluno` } })).id;
  });

  after(async () => {
    await prisma.financialRecord.deleteMany({ where: { description: { contains: tag } } });
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.$disconnect();
    await app.close();
  });

  const finBody = (amountCents: number) => ({
    description: `${tag} mensalidade`,
    amountCents,
    dueDate: '2030-01-10',
    studentId,
    type: 'MENSALIDADE',
  });

  it('POST /finance com amountCents 99999999999 => 400 e nada gravado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/finance')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send(finBody(99999999999));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.message, 'Valor numérico fora do intervalo permitido.');
    assert.equal(await prisma.financialRecord.count({ where: { description: { contains: tag } } }), 0);
  });

  it('controle: valor dentro do range continua 201 (o filtro não engole o caminho feliz)', async () => {
    await request(app.getHttpServer())
      .post('/api/finance')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send(finBody(15000))
      .expect(201);
    assert.equal(await prisma.financialRecord.count({ where: { description: { contains: tag } } }), 1);
  });

  it('GET /plans/99999999999 (owner de plataforma) => 400; id válido inexistente continua 404', async () => {
    const big = await request(app.getHttpServer())
      .get('/api/plans/99999999999')
      .set('Authorization', `Bearer ${platformToken}`);
    assert.equal(big.status, 400, JSON.stringify(big.body));
    await request(app.getHttpServer()).get('/api/plans/2000000000').set('Authorization', `Bearer ${platformToken}`).expect(404);
  });
});
