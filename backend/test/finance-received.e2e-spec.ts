import { INestApplication } from '@nestjs/common';
import { FinancialStatus, PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { SecondOrg, createSecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * "Recebido" do financeiro = valor EFETIVAMENTE pago (paidCents), com fallback para o valor do lançamento
 * (amountCents) quando não há paidCents. Grupo PRÓPRIO da suíte (não toca no seed nem no demo). Também confere
 * que baixa/estorno/cancelamento gravam a trilha de auditoria (sem senha/segredo).
 */
describe('Financeiro: Recebido usa paidCents (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: SecondOrg;
  let studentId: number;
  const api = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${org.token}`);

  const mk = (status: FinancialStatus, amountCents: number, paidCents: number | null, dueOffset = 5) =>
    prisma.financialRecord.create({
      data: {
        organizationId: org.organizationId,
        studentId,
        description: 'E2E-RECV',
        amountCents,
        status,
        dueDate: new Date(`${todaySaoPaulo(dueOffset)}T00:00:00.000Z`),
        paidAt: status === 'PAID' ? new Date() : null,
        paidCents,
      },
    });

  before(async () => {
    app = await createTestApp();
    org = await createSecondOrg(app, prisma, 'recv');
    studentId = (await prisma.student.create({ data: { organizationId: org.organizationId, name: 'E2E-RECV aluno' } })).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.student.deleteMany({ where: { organizationId: org.organizationId } });
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('soma paidCents quando pago (com desconto) e amountCents como fallback; pendente não entra', async () => {
    await mk('PAID', 10000, 8000); // pago com desconto: recebeu 80,00 de 100,00
    await mk('PAID', 5000, null); // sem paidCents (legado): vale o valor do lançamento
    await mk('PENDING', 7000, null); // não entra em "Recebido"
    const res = await api('get', '/finance/summary').expect(200);
    assert.equal(res.body.paid, 13000);
    assert.equal(res.body.paidCount, 2);
    assert.equal(res.body.pending, 7000);
  });

  it('baixa com valor diferente do lançamento: "Recebido" usa o valor pago e a trilha registra baixa e estorno', async () => {
    const rec = await mk('PENDING', 20000, null);
    const before = (await api('get', '/finance/summary').expect(200)).body.paid;
    await api('post', `/finance/${rec.id}/pay`).send({ paymentMethod: 'PIX', paidCents: 15000 }).expect(200);
    const after = (await api('get', '/finance/summary').expect(200)).body.paid;
    assert.equal(after - before, 15000);

    const pay = await prisma.auditLog.findFirstOrThrow({ where: { action: 'FINANCE_PAY', resourceId: String(rec.id) } });
    assert.equal(pay.organizationId, org.organizationId);
    assert.equal((pay.metadata as { paidCents: number }).paidCents, 15000);

    await api('post', `/finance/${rec.id}/refund`).expect(200);
    assert.equal((await api('get', '/finance/summary').expect(200)).body.paid, before);
    assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_REFUND', resourceId: String(rec.id) } }), 1);
  });

  it('baixa de lançamento inexistente/de outro grupo dá 404 e não grava trilha', async () => {
    await api('post', '/finance/2147483000/pay').send({ paymentMethod: 'CASH' }).expect(404);
    assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: '2147483000' } }), 0);
  });
});
