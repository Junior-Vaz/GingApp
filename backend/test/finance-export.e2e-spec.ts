import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createReportOrg, ReportOrg } from './utils/report-fixtures';
import { createSecondOrg, SecondOrg, todaySaoPaulo } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Exportação CSV do financeiro: GET /finance/export.csv (lançamentos) e /finance/delinquents/export.csv.
 * Grupo próprio; segunda via independente = Prisma direto.
 */
describe('Financeiro: exportação CSV (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  let s1: number;
  let s2: number;

  const get = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const dataLines = (text: string) => text.slice(1).split('\r\n').filter(Boolean).slice(1);
  const day = (offset: number) => new Date(`${todaySaoPaulo(offset)}T00:00:00.000Z`);

  before(async () => {
    app = await createTestApp();
    org = await createReportOrg(app, prisma, 'finexp');
    orgB = await createSecondOrg(app, prisma, 'finexpb');
    const a = await prisma.student.create({ data: { organizationId: org.organizationId, unitId: org.unitA.id, name: '=CMD|calc' } });
    const b = await prisma.student.create({ data: { organizationId: org.organizationId, unitId: org.unitB.id, name: 'Beatriz Lima' } });
    s1 = a.id;
    s2 = b.id;
    const base = { organizationId: org.organizationId };
    await prisma.financialRecord.createMany({
      data: [
        { ...base, studentId: s1, unitId: org.unitA.id, description: 'Mensalidade paga', type: 'MENSALIDADE', amountCents: 15000, dueDate: day(-20), status: 'PAID', paidAt: day(-18), paidCents: 14500, paymentMethod: 'PIX' },
        { ...base, studentId: s1, unitId: org.unitA.id, description: 'Mensalidade a vencer', amountCents: 15000, dueDate: day(10), status: 'PENDING' },
        { ...base, studentId: s1, unitId: org.unitA.id, description: 'Mensalidade vencida', amountCents: 20050, dueDate: day(-5), status: 'PENDING' },
        { ...base, studentId: s2, unitId: org.unitB.id, description: 'Uniforme', amountCents: 8000, dueDate: day(-3), status: 'OVERDUE' },
        { ...base, studentId: s2, unitId: org.unitB.id, description: 'Cancelada', amountCents: 9999, dueDate: day(-2), status: 'CANCELLED' },
      ],
    });
  });

  after(async () => {
    await orgB.cleanup();
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /finance/export.csv', () => {
    it('lista os lançamentos com status EFETIVO (pendente vencido = Atrasado), valores em reais e fórmula neutralizada', async () => {
      const res = await get('/finance/export.csv', org.mestre.token).expect(200);
      assert.match(res.headers['content-type'], /text\/csv/);
      assert.equal(res.text.charCodeAt(0), 0xfeff);
      assert.equal(
        res.text.slice(1).split('\r\n')[0],
        'ID;Aluno;Descrição;Tipo;Competência;Vencimento;Situação;Valor (R$);Valor pago (R$);Pago em;Forma de pagamento;Unidade',
      );
      const lines = dataLines(res.text);
      assert.equal(lines.length, 5);
      assert.equal(res.headers['x-total-count'], '5');
      const paid = lines.find((l) => l.includes('Mensalidade paga'))!;
      assert.match(paid, /;Pago;150,00;145,00;\d{2}\/\d{2}\/\d{4};Pix;/);
      assert.ok(lines.find((l) => l.includes('Mensalidade vencida'))!.includes(';Atrasado;200,50;;'));
      assert.ok(lines.find((l) => l.includes('Mensalidade a vencer'))!.includes(';Pendente;150,00;;'));
      assert.ok(lines.find((l) => l.includes('Cancelada'))!.includes(';Cancelado;'));
      assert.ok(res.text.includes(";'=CMD|calc;"), 'nome do aluno começando com = vira texto');
    });

    it('respeita os filtros da tela: status efetivo OVERDUE inclui o pendente vencido; from/to por vencimento', async () => {
      const overdue = await get('/finance/export.csv?status=OVERDUE', org.mestre.token).expect(200);
      assert.equal(dataLines(overdue.text).length, 2);
      const window = await get(`/finance/export.csv?from=${todaySaoPaulo(-6)}&to=${todaySaoPaulo(-3)}`, org.mestre.token).expect(200);
      assert.deepEqual(dataLines(window.text).map((l) => l.split(';')[2]).sort(), ['Mensalidade vencida', 'Uniforme']);
      await get('/finance/export.csv?status=INVALIDO', org.mestre.token).expect(400);
    });

    it('PROFESSOR e ALUNO levam 403, sem token 401; outro grupo recebe só o cabeçalho', async () => {
      await get('/finance/export.csv', org.professor.token).expect(403);
      await get('/finance/export.csv', org.aluno.token).expect(403);
      await get('/finance/export.csv').expect(401);
      const other = await get('/finance/export.csv', orgB.token).expect(200);
      assert.equal(dataLines(other.text).length, 0);
      assert.ok(!other.text.includes('Mensalidade'));
    });
  });

  describe('GET /finance/delinquents/export.csv', () => {
    it('um aluno por linha, do maior débito ao menor, com valor em atraso, total em aberto e dias', async () => {
      const res = await get('/finance/delinquents/export.csv', org.mestre.token).expect(200);
      assert.equal(
        res.text.slice(1).split('\r\n')[0],
        'Aluno;Unidade;Telefone;E-mail;Responsáveis;Lançamentos em atraso;Valor em atraso (R$);Total em aberto (R$);Vencimento mais antigo;Dias de atraso',
      );
      const lines = dataLines(res.text);
      assert.equal(lines.length, 2);
      // s1: 200,50 vencido (1 lançamento) e 150,00 a vencer => aberto 350,50; s2: 80,00 atrasado
      assert.match(lines[0], new RegExp(`^'=CMD\\|calc;${org.unitA.name};;;;1;200,50;350,50;\\d{2}/\\d{2}/\\d{4};5$`));
      assert.match(lines[1], new RegExp(`^Beatriz Lima;${org.unitB.name};;;;1;80,00;80,00;\\d{2}/\\d{2}/\\d{4};3$`));
      assert.equal(res.headers['x-total-count'], '2');
      const filtered = await get(`/finance/delinquents/export.csv?unitId=${org.unitB.id}`, org.mestre.token).expect(200);
      assert.equal(dataLines(filtered.text).length, 1);
    });

    it('PROFESSOR e ALUNO levam 403; outro grupo não vê os inadimplentes', async () => {
      await get('/finance/delinquents/export.csv', org.professor.token).expect(403);
      await get('/finance/delinquents/export.csv', org.aluno.token).expect(403);
      const other = await get('/finance/delinquents/export.csv', orgB.token).expect(200);
      assert.equal(dataLines(other.text).length, 0);
    });
  });
});
