import { INestApplication } from '@nestjs/common';
import { FinancialStatus, OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';

/**
 * Cobranca de mensalidade (E07) de ponta a ponta: cobranca por aluno (StudentBilling), geracao mensal em
 * lote idempotente, baixa/estorno/cancelamento, inadimplentes (reuso de FinanceOverdueService), recibo,
 * "como pagar" (Organization.paymentInstructions) e RBAC/isolamento multi-tenant.
 *
 * Tudo roda em organizacoes PROPRIAS (createSecondOrg) — nunca toca no seed (ginga-brasil) nem no grupo
 * demo — e o after() apaga tudo que foi criado (inclusive Units e Notifications). Segunda via independente
 * = Prisma direto. Meses da geracao ficam nos anos 2040+ (futuro estavel: nunca viram atraso).
 */
const TAG = `${Date.now()}`;
const MAIL_DOMAIN = 'e2e-billing.local';

describe('Finance billing: mensalidades, baixa, inadimplentes, recibo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();

  let main: SecondOrg; // grupo principal (geracao, baixa, recibo, RBAC)
  let delq: SecondOrg; // grupo dos inadimplentes (numeros exatos)
  let other: SecondOrg; // grupo alheio (isolamento)
  const extraUserIds: number[] = [];
  let professorToken: string;
  let alunoToken: string;
  let alunoStudentId: number;
  let alunoUserId: number;
  let unitAId: number;
  let unitOtherId: number;
  const orgIds = (): number[] => [main.organizationId, delq.organizationId, other.organizationId];

  const api = (method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) => {
    const req = request(server())[method](`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  const mkStudent = (organizationId: number, name: string, extra: Record<string, unknown> = {}) =>
    prisma.student.create({ data: { organizationId, name: `E2E-BILL ${TAG} ${name}`, ...extra } });
  const setFee = (organizationId: number, studentId: number, monthlyFeeCents: number, dueDay: number) =>
    prisma.studentBilling.create({ data: { organizationId, studentId, monthlyFeeCents, dueDay } });
  const mkRecord = (
    organizationId: number,
    studentId: number | null,
    status: FinancialStatus,
    amountCents: number,
    dueOffsetDays: number,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.financialRecord.create({
      data: {
        organizationId,
        studentId,
        description: `E2E-BILL ${TAG} lancamento`,
        amountCents,
        status,
        dueDate: new Date(`${todaySaoPaulo(dueOffsetDays)}T00:00:00.000Z`),
        ...extra,
      },
    });

  async function makeMember(organizationId: number, role: OrgRole, kind: string) {
    const email = `${kind}-${TAG}@${MAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `E2E-BILL ${kind}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    extraUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    const { token } = await loginAs(app, email);
    return { userId: user.id, token };
  }

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    main = await createSecondOrg(app, prisma, `bill-main-${TAG}`);
    delq = await createSecondOrg(app, prisma, `bill-delq-${TAG}`);
    other = await createSecondOrg(app, prisma, `bill-other-${TAG}`);
    await prisma.organization.update({
      where: { id: main.organizationId },
      data: { document: '12345678000190', phone: '(62) 99999-0000', city: 'Goiania', state: 'GO' },
    });
    unitAId = (await prisma.unit.create({ data: { organizationId: main.organizationId, name: `E2E-BILL ${TAG} Filial A` } })).id;
    unitOtherId = (await prisma.unit.create({ data: { organizationId: other.organizationId, name: `E2E-BILL ${TAG} Filial X` } })).id;

    professorToken = (await makeMember(main.organizationId, OrgRole.PROFESSOR, 'professor')).token;
    const aluno = await makeMember(main.organizationId, OrgRole.ALUNO, 'aluno');
    alunoToken = aluno.token;
    alunoUserId = aluno.userId;
    alunoStudentId = (await mkStudent(main.organizationId, 'Aluno Logado', { userId: aluno.userId, unitId: unitAId })).id;
  });

  after(async () => {
    const ids = orgIds();
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: ids } }, { userId: { in: extraUserIds } }] } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.studentBilling.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await delq.cleanup();
    await other.cleanup();
    await main.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // -----------------------------------------------------------------------------------------------
  describe('RBAC: so o MESTRE cobra', () => {
    const calls: [string, 'get' | 'post' | 'put', string, object?][] = [
      ['GET billing', 'get', '/finance/billing?studentIds=1'],
      ['GET billing/:id', 'get', '/finance/billing/1'],
      ['PUT billing/:id', 'put', '/finance/billing/1', { monthlyFeeCents: 100, dueDay: 5 }],
      ['POST generate-monthly', 'post', '/finance/generate-monthly', { month: '2040-01' }],
      ['GET delinquents', 'get', '/finance/delinquents'],
      ['GET delinquents/summary', 'get', '/finance/delinquents/summary'],
      ['POST :id/pay', 'post', '/finance/1/pay', { paymentMethod: 'PIX' }],
      ['POST :id/refund', 'post', '/finance/1/refund'],
      ['POST :id/cancel', 'post', '/finance/1/cancel'],
      ['GET :id/receipt', 'get', '/finance/1/receipt'],
    ];

    for (const [label, method, path, body] of calls) {
      it(`${label}: sem token 401, PROFESSOR 403, ALUNO 403`, async () => {
        const send = (token?: string) => {
          const req = api(method, path, token);
          return body ? req.send(body) : req;
        };
        await send().expect(401);
        await send(professorToken).expect(403);
        await send(alunoToken).expect(403);
      });
    }

    it('nada foi criado pelas chamadas negadas (zero lancamentos/cobrancas no grupo)', async () => {
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId } }), 0);
      assert.equal(await prisma.studentBilling.count({ where: { organizationId: main.organizationId } }), 0);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('Cobranca por aluno (valor + dia de vencimento)', () => {
    let studentId: number;
    before(async () => {
      studentId = (await mkStudent(main.organizationId, 'Cobranca Aluno')).id;
    });

    it('GET sem cobranca definida devolve nulls (200)', async () => {
      const res = await api('get', `/finance/billing/${studentId}`, main.token).expect(200);
      assert.deepEqual(res.body, { studentId, monthlyFeeCents: null, dueDay: null });
    });

    it('PUT define valor e dia; GET e a lista por studentIds devolvem; a linha existe no banco', async () => {
      const put = await api('put', `/finance/billing/${studentId}`, main.token)
        .send({ monthlyFeeCents: 15050, dueDay: 10 })
        .expect(200);
      assert.deepEqual(put.body, { studentId, monthlyFeeCents: 15050, dueDay: 10 });

      const get = await api('get', `/finance/billing/${studentId}`, main.token).expect(200);
      assert.equal(get.body.monthlyFeeCents, 15050);
      const list = await api('get', `/finance/billing?studentIds=${studentId},${alunoStudentId}`, main.token).expect(200);
      assert.deepEqual(list.body, [{ studentId, monthlyFeeCents: 15050, dueDay: 10 }]);

      const row = await prisma.studentBilling.findUniqueOrThrow({ where: { studentId } });
      assert.equal(row.organizationId, main.organizationId);
      assert.equal(row.monthlyFeeCents, 15050);
    });

    it('PUT de novo ATUALIZA (nao duplica) a mesma linha', async () => {
      await api('put', `/finance/billing/${studentId}`, main.token).send({ monthlyFeeCents: 20000, dueDay: 31 }).expect(200);
      assert.equal(await prisma.studentBilling.count({ where: { studentId } }), 1);
      const row = await prisma.studentBilling.findUniqueOrThrow({ where: { studentId } });
      assert.deepEqual([row.monthlyFeeCents, row.dueDay], [20000, 31]);
    });

    it('validacao: valor 0/negativo/decimal/estouro INT4/string, dia 0/32, chave ausente e valor sem dia => 400 e nada muda', async () => {
      const bad: object[] = [
        { monthlyFeeCents: 0, dueDay: 5 },
        { monthlyFeeCents: -1, dueDay: 5 },
        { monthlyFeeCents: 10.5, dueDay: 5 },
        { monthlyFeeCents: 2147483648, dueDay: 5 },
        { monthlyFeeCents: '100', dueDay: 5 },
        { monthlyFeeCents: 100, dueDay: 0 },
        { monthlyFeeCents: 100, dueDay: 32 },
        { monthlyFeeCents: 100 },
        { dueDay: 5 },
        { monthlyFeeCents: 100, dueDay: null },
        { monthlyFeeCents: null, dueDay: 5 },
        { monthlyFeeCents: 100, dueDay: 5, extra: 1 },
      ];
      for (const body of bad) {
        await api('put', `/finance/billing/${studentId}`, main.token).send(body).expect(400);
      }
      const row = await prisma.studentBilling.findUniqueOrThrow({ where: { studentId } });
      assert.deepEqual([row.monthlyFeeCents, row.dueDay], [20000, 31]);
    });

    it('studentIds invalido na lista => 400', async () => {
      await api('get', '/finance/billing?studentIds=abc', main.token).expect(400);
      await api('get', '/finance/billing?studentIds=1,,2', main.token).expect(400);
      await api('get', '/finance/billing', main.token).expect(400);
      await api('get', '/finance/billing?studentIds=2147483648', main.token).expect(400);
    });

    it('aluno inexistente / de outro grupo => 404 em GET e PUT; a lista do outro grupo nao enxerga a cobranca', async () => {
      await api('get', `/finance/billing/${studentId}`, other.token).expect(404);
      await api('put', `/finance/billing/${studentId}`, other.token).send({ monthlyFeeCents: 1, dueDay: 1 }).expect(404);
      await api('get', '/finance/billing/2147483647', main.token).expect(404);
      const list = await api('get', `/finance/billing?studentIds=${studentId}`, other.token).expect(200);
      assert.deepEqual(list.body, []);
      const row = await prisma.studentBilling.findUniqueOrThrow({ where: { studentId } });
      assert.equal(row.monthlyFeeCents, 20000, 'o PUT do outro grupo nao pode ter alterado nada');
    });

    it('PUT com os dois null REMOVE a cobranca (GET volta a nulls)', async () => {
      await api('put', `/finance/billing/${studentId}`, main.token).send({ monthlyFeeCents: null, dueDay: null }).expect(200);
      assert.equal(await prisma.studentBilling.count({ where: { studentId } }), 0);
      const res = await api('get', `/finance/billing/${studentId}`, main.token).expect(200);
      assert.equal(res.body.monthlyFeeCents, null);
    });

    it('apagar o aluno remove a cobranca em cascata (sem linha orfa)', async () => {
      const s = await mkStudent(main.organizationId, 'Cascata');
      await setFee(main.organizationId, s.id, 1000, 1);
      await prisma.student.delete({ where: { id: s.id } });
      assert.equal(await prisma.studentBilling.count({ where: { studentId: s.id } }), 0);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('Geracao mensal em lote', () => {
    const FEB = '2041-02'; // 28 dias (2041 nao e bissexto)
    const LEAP = '2044-02'; // 29 dias
    const APR = '2041-04'; // 30 dias
    let s1: number; // dia 10
    let s2: number; // dia 31 (mes curto)
    let sNoFee: number;
    let sInactive: number;
    let sUnit: number; // unidade A, dia 5
    let sManual: number; // ja tem mensalidade avulsa no mes
    const generate = (month: string, extra: object = {}, token = main.token) =>
      api('post', '/finance/generate-monthly', token).send({ month, ...extra });
    const recordsOf = (month: string, organizationId = main.organizationId) =>
      prisma.financialRecord.findMany({ where: { organizationId, competence: month }, orderBy: { studentId: 'asc' } });

    before(async () => {
      s1 = (await mkStudent(main.organizationId, 'Gera 1')).id;
      s2 = (await mkStudent(main.organizationId, 'Gera 2 dia 31')).id;
      sNoFee = (await mkStudent(main.organizationId, 'Sem valor')).id;
      sInactive = (await mkStudent(main.organizationId, 'Inativo', { status: 'INACTIVE' })).id;
      sUnit = (await mkStudent(main.organizationId, 'Da unidade A', { unitId: unitAId })).id;
      sManual = (await mkStudent(main.organizationId, 'Avulso ja lancado')).id;
      await setFee(main.organizationId, s1, 10000, 10);
      await setFee(main.organizationId, s2, 15050, 31);
      await setFee(main.organizationId, sInactive, 9999, 5);
      await setFee(main.organizationId, sUnit, 12000, 5);
      await setFee(main.organizationId, sManual, 8000, 15);
      await setFee(main.organizationId, alunoStudentId, 11000, 20);
      // Mensalidade lancada a mao (sem competencia) no mes: o gerador nao pode cobrar o aluno de novo.
      await prisma.financialRecord.create({
        data: {
          organizationId: main.organizationId,
          studentId: sManual,
          description: 'mensalidade feita a mao',
          amountCents: 8000,
          type: 'mensalidade', // caixa diferente de proposito
          dueDate: new Date(`${FEB}-15T00:00:00.000Z`),
        },
      });
    });

    it('1a chamada: cria so para ACTIVE com valor (descricao, tipo, competencia, valor, unidade); conta os sem valor', async () => {
      const res = await generate(FEB).expect(200);
      // s1, s2, sUnit, aluno logado criados; sManual ja tem avulso => ignorado; sInactive fora; sNoFee conta como "sem valor".
      assert.equal(res.body.month, FEB);
      assert.equal(res.body.created, 4);
      assert.equal(res.body.ignored, 1);
      assert.equal(res.body.withoutFee, 2); // "Sem valor" + "Cobranca Aluno" (cuja cobranca o bloco anterior removeu)
      assert.deepEqual(res.body.ignoredStudents.map((i: { studentId: number }) => i.studentId), [sManual]);

      const rows = await recordsOf(FEB);
      assert.deepEqual(rows.map((r) => r.studentId).sort((a, b) => a! - b!), [s1, s2, sUnit, alunoStudentId].sort((a, b) => a - b));
      const r1 = rows.find((r) => r.studentId === s1)!;
      assert.equal(r1.description, 'Mensalidade 02/2041');
      assert.equal(r1.type, 'MENSALIDADE');
      assert.equal(r1.amountCents, 10000);
      assert.equal(r1.status, 'PENDING');
      assert.equal(r1.dueDate.toISOString(), '2041-02-10T00:00:00.000Z');
      assert.equal(r1.unitId, null);
      assert.equal(rows.find((r) => r.studentId === sUnit)!.unitId, unitAId);
      assert.equal(rows.find((r) => r.studentId === sInactive), undefined);
      assert.equal(rows.find((r) => r.studentId === sNoFee), undefined);
    });

    it('mes curto: dia 31 vira o ultimo dia (28/fev, 29/fev bissexto, 30/abr)', async () => {
      assert.equal((await recordsOf(FEB)).find((r) => r.studentId === s2)!.dueDate.toISOString(), '2041-02-28T00:00:00.000Z');
      await generate(LEAP).expect(200);
      assert.equal((await recordsOf(LEAP)).find((r) => r.studentId === s2)!.dueDate.toISOString(), '2044-02-29T00:00:00.000Z');
      await generate(APR).expect(200);
      assert.equal((await recordsOf(APR)).find((r) => r.studentId === s2)!.dueDate.toISOString(), '2041-04-30T00:00:00.000Z');
      assert.equal((await recordsOf(APR)).find((r) => r.studentId === s1)!.dueDate.toISOString(), '2041-04-10T00:00:00.000Z');
    });

    it('IDEMPOTENTE: repetir o mes nao duplica nada (created 0, ignored = todos) e o banco continua com 1 por aluno', async () => {
      const before = await prisma.financialRecord.count({ where: { organizationId: main.organizationId } });
      const res = await generate(FEB).expect(200);
      assert.equal(res.body.created, 0);
      assert.equal(res.body.ignored, 5);
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId } }), before);
      const dup = await prisma.financialRecord.groupBy({
        by: ['studentId'],
        where: { organizationId: main.organizationId, competence: FEB },
        _count: { _all: true },
      });
      assert.ok(dup.every((g) => g._count._all === 1));
    });

    it('aluno novo com valor entra na proxima chamada; os antigos continuam ignorados', async () => {
      const novo = await mkStudent(main.organizationId, 'Chegou depois');
      await setFee(main.organizationId, novo.id, 7000, 3);
      const res = await generate(FEB).expect(200);
      assert.equal(res.body.created, 1);
      assert.equal(res.body.ignored, 5);
      assert.equal((await recordsOf(FEB)).find((r) => r.studentId === novo.id)!.amountCents, 7000);
    });

    it('mensalidade CANCELADA nao renasce: regerar o mes ignora o aluno', async () => {
      const rec = (await recordsOf(FEB)).find((r) => r.studentId === s1)!;
      await api('post', `/finance/${rec.id}/cancel`, main.token).expect(200);
      const res = await generate(FEB).expect(200);
      assert.equal(res.body.created, 0);
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId, competence: FEB, studentId: s1 } }), 1);
    });

    it('alterar o valor do aluno NAO altera lancamentos ja gerados', async () => {
      await api('put', `/finance/billing/${s2}`, main.token).send({ monthlyFeeCents: 99999, dueDay: 1 }).expect(200);
      assert.equal((await recordsOf(FEB)).find((r) => r.studentId === s2)!.amountCents, 15050);
      await api('put', `/finance/billing/${s2}`, main.token).send({ monthlyFeeCents: 15050, dueDay: 31 }).expect(200);
    });

    it('filtro por unidade gera so os alunos dela; unidade de outro grupo => 400', async () => {
      const MAR = '2041-03';
      const only = await generate(MAR, { unitId: unitAId }).expect(200);
      assert.equal(only.body.created, 2); // sUnit + aluno logado (ambos na unidade A)
      assert.deepEqual((await recordsOf(MAR)).map((r) => r.unitId), [unitAId, unitAId]);
      const rest = await generate(MAR).expect(200);
      assert.equal(rest.body.created, 4); // s1, s2, sManual, novo (sem avulso em marco)
      assert.equal(rest.body.ignored, 2);
      await generate(MAR, { unitId: unitOtherId }).expect(400);
    });

    it('validacao do mes: formato, mes 13, ano fora de 2000-2100, vazio, tipo errado, campo extra => 400 e nada gravado', async () => {
      const before = await prisma.financialRecord.count({ where: { organizationId: main.organizationId } });
      for (const body of [
        { month: '2041-13' },
        { month: '2041-00' },
        { month: '2041-2' },
        { month: '41-02' },
        { month: '1999-12' },
        { month: '2101-01' },
        { month: '' },
        { month: 202102 },
        {},
        { month: '2041-02', extra: true },
        { month: '2041-02', unitId: 'x' },
      ]) {
        await api('post', '/finance/generate-monthly', main.token).send(body).expect(400);
      }
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId } }), before);
    });

    it('chamadas CONCORRENTES do mesmo mes nao duplicam (unique + skipDuplicates): soma dos created = elegiveis', async () => {
      const MAY = '2041-05';
      const eligible = await prisma.studentBilling.count({ where: { organizationId: main.organizationId, student: { status: 'ACTIVE' } } });
      const results = await Promise.all([generate(MAY), generate(MAY), generate(MAY)]);
      results.forEach((r) => assert.equal(r.status, 200));
      const totalCreated = results.reduce((sum, r) => sum + (r.body.created as number), 0);
      assert.equal(totalCreated, eligible);
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId, competence: MAY } }), eligible);
    });

    it('o banco recusa duplicata direta (unique aluno+competencia+tipo), mas lancamentos avulsos continuam livres', async () => {
      await assert.rejects(
        prisma.financialRecord.create({
          data: {
            organizationId: main.organizationId,
            studentId: s1,
            description: 'dup',
            amountCents: 1,
            type: 'MENSALIDADE',
            competence: FEB,
            dueDate: new Date(`${FEB}-10T00:00:00.000Z`),
          },
        }),
      );
      const a = await mkRecord(main.organizationId, s1, 'PENDING', 100, 100);
      const b = await mkRecord(main.organizationId, s1, 'PENDING', 100, 100);
      assert.notEqual(a.id, b.id);
    });

    it('ISOLAMENTO: gerar no grupo alheio nao cria nada aqui e usa so as cobrancas dele', async () => {
      const mine = await prisma.financialRecord.count({ where: { organizationId: main.organizationId } });
      const o = await mkStudent(other.organizationId, 'Aluno do outro grupo');
      await setFee(other.organizationId, o.id, 5000, 7);
      const res = await generate('2041-06', {}, other.token).expect(200);
      assert.equal(res.body.created, 1);
      assert.equal(await prisma.financialRecord.count({ where: { organizationId: main.organizationId } }), mine);
      const rows = await recordsOf('2041-06', other.organizationId);
      assert.deepEqual(rows.map((r) => r.studentId), [o.id]);
      assert.equal(rows[0].organizationId, other.organizationId);
    });

    it('o aluno logado enxerga a mensalidade gerada em /finance/me (e so a dele)', async () => {
      const res = await api('get', '/finance/me', alunoToken).expect(200);
      assert.ok(res.body.length >= 1);
      assert.ok(res.body.every((r: { studentId: number }) => r.studentId === alunoStudentId));
      const feb = res.body.find((r: { competence: string }) => r.competence === FEB);
      assert.equal(feb.amountCents, 11000);
      assert.equal(feb.dueDate, '2041-02-20T00:00:00.000Z');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('Baixa, estorno, cancelamento e recibo', () => {
    let studentId: number;
    before(async () => {
      studentId = (await mkStudent(main.organizationId, 'Baixa Aluno', { document: '123.456.789-09', unitId: unitAId })).id;
    });
    const pay = (id: number, body: object, token = main.token) => api('post', `/finance/${id}/pay`, token).send(body);

    it('baixa de PENDING: PAID + paidAt = hoje (Sao Paulo) + forma + paidCents padrao = valor', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 15000, 5, { type: 'MENSALIDADE', competence: '2042-01' });
      const res = await pay(rec.id, { paymentMethod: 'PIX' }).expect(200);
      assert.equal(res.body.status, 'PAID');
      assert.equal(res.body.paymentMethod, 'PIX');
      assert.equal(res.body.paidCents, 15000);
      const row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(row.status, 'PAID');
      assert.equal(row.paidAt!.toISOString(), `${todaySaoPaulo()}T00:00:00.000Z`);
      assert.equal(row.paidCents, 15000);
      assert.equal(row.paymentMethod, 'PIX');
    });

    it('baixa de lancamento ATRASADO (PENDING vencido e OVERDUE gravado) com data retroativa e valor pago diferente', async () => {
      const late = await mkRecord(main.organizationId, studentId, 'PENDING', 10000, -30);
      const overdue = await mkRecord(main.organizationId, studentId, 'OVERDUE', 10000, -60);
      const day = todaySaoPaulo(-2);
      await pay(late.id, { paymentMethod: 'CASH', paidAt: day, paidCents: 9000 }).expect(200);
      await pay(overdue.id, { paymentMethod: 'CARD', paidAt: `${day}T15:30:00.000Z` }).expect(200);
      const a = await prisma.financialRecord.findUniqueOrThrow({ where: { id: late.id } });
      const b = await prisma.financialRecord.findUniqueOrThrow({ where: { id: overdue.id } });
      assert.equal(a.paidAt!.toISOString(), `${day}T00:00:00.000Z`);
      assert.equal(a.paidCents, 9000);
      assert.equal(a.paymentMethod, 'CASH');
      assert.equal(b.paidAt!.toISOString(), `${day}T00:00:00.000Z`, 'a hora do ISO e descartada: paidAt e data civil');
      assert.equal(b.paymentMethod, 'CARD');
    });

    it('as 5 formas de pagamento sao aceitas', async () => {
      for (const paymentMethod of ['CASH', 'PIX', 'CARD', 'TRANSFER', 'OTHER']) {
        const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 100, 3);
        await pay(rec.id, { paymentMethod }).expect(200);
        assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).paymentMethod, paymentMethod);
      }
    });

    it('validacao: forma ausente/invalida, data futura/malformada, paidCents 0/estouro/decimal, campo extra => 400 e o lancamento fica PENDING', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      for (const body of [
        {},
        { paymentMethod: 'BITCOIN' },
        { paymentMethod: 'pix' },
        { paymentMethod: 'PIX', paidAt: todaySaoPaulo(1) },
        { paymentMethod: 'PIX', paidAt: 'ontem' },
        { paymentMethod: 'PIX', paidCents: 0 },
        { paymentMethod: 'PIX', paidCents: 2147483648 },
        { paymentMethod: 'PIX', paidCents: 10.5 },
        { paymentMethod: 'PIX', status: 'PAID' },
      ]) {
        await pay(rec.id, body).expect(400);
      }
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).status, 'PENDING');
    });

    it('baixar de novo um lancamento pago => 409 e nada muda; cancelado nao recebe baixa => 409', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      await pay(rec.id, { paymentMethod: 'PIX', paidCents: 4000 }).expect(200);
      await pay(rec.id, { paymentMethod: 'CASH', paidCents: 1 }).expect(409);
      const row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.deepEqual([row.paymentMethod, row.paidCents], ['PIX', 4000]);

      const cancelled = await mkRecord(main.organizationId, studentId, 'CANCELLED', 5000, 3);
      await pay(cancelled.id, { paymentMethod: 'PIX' }).expect(409);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: cancelled.id } })).status, 'CANCELLED');
    });

    it('baixas SIMULTANEAS do mesmo lancamento: exatamente uma vence (200) e as outras recebem 409', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      const results = await Promise.all(
        [1, 2, 3, 4].map((n) => pay(rec.id, { paymentMethod: 'PIX', paidCents: 1000 * n })),
      );
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.equal(results.filter((r) => r.status === 409).length, 3);
    });

    it('ISOLAMENTO: outro grupo nao baixa, estorna, cancela nem le recibo (404) e nada muda', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      await pay(rec.id, { paymentMethod: 'PIX' }, other.token).expect(404);
      await api('post', `/finance/${rec.id}/cancel`, other.token).expect(404);
      await api('post', `/finance/${rec.id}/refund`, other.token).expect(404);
      await api('get', `/finance/${rec.id}/receipt`, other.token).expect(404);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).status, 'PENDING');
      await pay(2147483647, { paymentMethod: 'PIX' }).expect(404);
    });

    it('estorno: PAID -> PENDING limpando data/forma/valor; estornar pendente => 409', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      await pay(rec.id, { paymentMethod: 'TRANSFER', paidCents: 4500 }).expect(200);
      const res = await api('post', `/finance/${rec.id}/refund`, main.token).expect(200);
      assert.equal(res.body.status, 'PENDING');
      const row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.deepEqual([row.status, row.paidAt, row.paymentMethod, row.paidCents], ['PENDING', null, null, null]);
      await api('post', `/finance/${rec.id}/refund`, main.token).expect(409);
      await pay(rec.id, { paymentMethod: 'PIX' }).expect(200); // pode ser baixado de novo depois do estorno
    });

    it('cancelamento: PENDING/OVERDUE -> CANCELLED; pago exige estorno; cancelar duas vezes => 409', async () => {
      const pending = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      const overdue = await mkRecord(main.organizationId, studentId, 'OVERDUE', 5000, -3);
      await api('post', `/finance/${pending.id}/cancel`, main.token).expect(200);
      await api('post', `/finance/${overdue.id}/cancel`, main.token).expect(200);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: pending.id } })).status, 'CANCELLED');
      await api('post', `/finance/${pending.id}/cancel`, main.token).expect(409);

      const paid = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      await pay(paid.id, { paymentMethod: 'PIX' }).expect(200);
      await api('post', `/finance/${paid.id}/cancel`, main.token).expect(409);
      await api('post', `/finance/${paid.id}/refund`, main.token).expect(200);
      await api('post', `/finance/${paid.id}/cancel`, main.token).expect(200);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: paid.id } })).status, 'CANCELLED');
    });

    it('PATCH que tira o lancamento de PAID tambem limpa forma de pagamento e valor pago', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 5000, 3);
      await pay(rec.id, { paymentMethod: 'PIX', paidCents: 4000 }).expect(200);
      await api('patch', `/finance/${rec.id}`, main.token).send({ status: 'PENDING' }).expect(200);
      const row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.deepEqual([row.paidAt, row.paymentMethod, row.paidCents], [null, null, null]);
    });

    it('recibo: dados do grupo, do aluno e do pagamento; numero estavel (ano-id); so para PAGO', async () => {
      const rec = await mkRecord(main.organizationId, studentId, 'PENDING', 15000, 5, {
        type: 'MENSALIDADE',
        competence: '2042-02',
        unitId: unitAId,
        description: 'Mensalidade 02/2042',
      });
      await api('get', `/finance/${rec.id}/receipt`, main.token).expect(409); // ainda nao pago
      await pay(rec.id, { paymentMethod: 'PIX', paidCents: 14000, paidAt: todaySaoPaulo(-1) }).expect(200);
      const res = await api('get', `/finance/${rec.id}/receipt`, main.token).expect(200);
      const year = todaySaoPaulo(-1).slice(0, 4);
      assert.equal(res.body.number, `${year}-${String(rec.id).padStart(6, '0')}`);
      assert.equal(res.body.organization.name, `E2E bill-main-${TAG} Org B`);
      assert.equal(res.body.organization.document, '12345678000190');
      assert.equal(res.body.organization.city, 'Goiania');
      assert.equal(res.body.student.name, `E2E-BILL ${TAG} Baixa Aluno`);
      assert.equal(res.body.student.document, '123.456.789-09');
      assert.equal(res.body.unit.name, `E2E-BILL ${TAG} Filial A`);
      assert.equal(res.body.description, 'Mensalidade 02/2042');
      assert.equal(res.body.amountCents, 15000);
      assert.equal(res.body.paidCents, 14000);
      assert.equal(res.body.paymentMethod, 'PIX');
      assert.equal(res.body.paidAt, `${todaySaoPaulo(-1)}T00:00:00.000Z`);
      assert.equal(res.body.dueDate, `${todaySaoPaulo(5)}T00:00:00.000Z`);
      assert.equal(JSON.stringify(res.body).includes('passwordHash'), false);
    });

    it('recibo de lancamento avulso (sem aluno/unidade) funciona e cancelado nao tem recibo', async () => {
      const avulso = await mkRecord(main.organizationId, null, 'PENDING', 2500, 1);
      await pay(avulso.id, { paymentMethod: 'CASH' }).expect(200);
      const res = await api('get', `/finance/${avulso.id}/receipt`, main.token).expect(200);
      assert.equal(res.body.student, null);
      assert.equal(res.body.unit, null);
      const cancelled = await mkRecord(main.organizationId, null, 'CANCELLED', 2500, 1);
      await api('get', `/finance/${cancelled.id}/receipt`, main.token).expect(409);
      await api('get', '/finance/2147483647/receipt', main.token).expect(404);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('Inadimplentes (e reuso de FinanceOverdueService)', () => {
    let d1: number;
    let d2: number;
    let d3: number;
    let unitD: number;
    let aluno1UserId: number;
    const list = (qs = '', token = delq.token) => api('get', `/finance/delinquents${qs}`, token);
    const summary = (qs = '', token = delq.token) => api('get', `/finance/delinquents/summary${qs}`, token);

    before(async () => {
      unitD = (await prisma.unit.create({ data: { organizationId: delq.organizationId, name: `E2E-BILL ${TAG} Unidade D` } })).id;
      const login = await prisma.user.create({
        data: {
          email: `aluno-d1-${TAG}@${MAIL_DOMAIN}`,
          passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
          name: 'E2E-BILL aluno d1',
          userType: 'MEMBER',
          status: 'ACTIVE',
        },
      });
      extraUserIds.push(login.id);
      aluno1UserId = login.id;
      await prisma.organizationUser.create({
        data: { organizationId: delq.organizationId, userId: login.id, role: OrgRole.ALUNO, status: 'ACTIVE' },
      });
      d1 = (await mkStudent(delq.organizationId, 'Zeca Atrasado', { unitId: unitD, phone: '62 99999-1111', email: 'zeca@x.com', userId: login.id })).id;
      d2 = (await mkStudent(delq.organizationId, 'Ana Devedora')).id;
      d3 = (await mkStudent(delq.organizationId, 'Bia Em Dia')).id;
      await prisma.studentGuardian.create({
        data: { organizationId: delq.organizationId, studentId: d2, name: 'Mae da Ana', relationship: 'Mae', phone: '62 98888-2222' },
      });

      const o = delq.organizationId;
      await mkRecord(o, d1, 'OVERDUE', 10000, -40); // atrasado gravado
      await mkRecord(o, d1, 'PENDING', 5000, -5); // PENDING vencido
      await mkRecord(o, d1, 'PENDING', 7000, 10); // a vencer (conta so em "em aberto")
      await mkRecord(o, d1, 'PAID', 2000, -20); // pago: fora
      await mkRecord(o, d1, 'CANCELLED', 999, -30); // cancelado: fora
      await mkRecord(o, d2, 'PENDING', 3000, -1);
      await mkRecord(o, d3, 'PENDING', 4000, 0); // vence HOJE: ainda nao e atraso
      await mkRecord(o, d3, 'PAID', 1500, -10);
      await mkRecord(o, d3, 'CANCELLED', 800, -10);
      await mkRecord(o, null, 'PENDING', 800, -10); // avulso sem aluno: nao e inadimplente
    });

    it('lista agrupada por aluno, do maior debito ao menor, com contato, responsaveis, atraso e em aberto', async () => {
      const res = await list().expect(200);
      assert.equal(res.headers['x-total-count'], '2');
      assert.equal(res.body.length, 2);
      const [a, b] = res.body;
      assert.equal(a.studentId, d1);
      assert.equal(a.studentName, `E2E-BILL ${TAG} Zeca Atrasado`);
      assert.equal(a.overdueCents, 15000);
      assert.equal(a.overdueCount, 2);
      assert.equal(a.openCents, 22000);
      assert.equal(a.phone, '62 99999-1111');
      assert.equal(a.email, 'zeca@x.com');
      assert.equal(a.unitId, unitD);
      assert.equal(a.oldestDueDate, `${todaySaoPaulo(-40)}T00:00:00.000Z`);
      assert.equal(a.daysLate, 40);
      assert.deepEqual(a.guardians, []);
      assert.equal(b.studentId, d2);
      assert.equal(b.overdueCents, 3000);
      assert.equal(b.daysLate, 1);
      assert.deepEqual(b.guardians, [{ name: 'Mae da Ana', relationship: 'Mae', phone: '62 98888-2222', email: null }]);
      assert.ok(!res.body.some((r: { studentId: number }) => r.studentId === d3), 'quem vence hoje/pagou nao e inadimplente');
    });

    it('resumo bate com a lista (alunos, valor e quantidade)', async () => {
      const res = await summary().expect(200);
      assert.deepEqual(res.body, { students: 2, overdueCents: 18000, overdueCount: 3 });
    });

    it('filtros: q (nome), unitId, studentId, from/to (vencimento)', async () => {
      const ids = (res: { body: { studentId: number }[] }) => res.body.map((r) => r.studentId);
      assert.deepEqual(ids(await list('?q=ANA').expect(200)), [d2]);
      assert.deepEqual(ids(await list(`?unitId=${unitD}`).expect(200)), [d1]);
      assert.deepEqual(ids(await list(`?studentId=${d2}`).expect(200)), [d2]);
      const recent = await list(`?from=${todaySaoPaulo(-10)}`).expect(200);
      assert.deepEqual(ids(recent), [d1, d2]);
      assert.equal(recent.body[0].overdueCents, 5000, 'so o lancamento de -5 dias cai na janela');
      assert.equal(recent.body[0].openCents, 22000, 'em aberto ignora o filtro de datas');
      const old = await list(`?to=${todaySaoPaulo(-30)}`).expect(200);
      assert.deepEqual(ids(old), [d1]);
      assert.equal(old.body[0].overdueCents, 10000);
      assert.deepEqual((await summary(`?q=zeca`).expect(200)).body, { students: 1, overdueCents: 15000, overdueCount: 2 });
      assert.deepEqual(ids(await list('?q=nao-existe').expect(200)), []);
    });

    it('paginacao: limit/offset com total de ALUNOS em X-Total-Count', async () => {
      const p1 = await list('?limit=1&offset=0').expect(200);
      const p2 = await list('?limit=1&offset=1').expect(200);
      assert.deepEqual([p1.body[0].studentId, p2.body[0].studentId], [d1, d2]);
      assert.equal(p1.headers['x-total-count'], '2');
      assert.equal(p2.headers['x-total-count'], '2');
      await list('?limit=0').expect(400);
      await list('?limit=201').expect(400);
      await list('?unitId=abc').expect(400);
      await list('?from=ontem').expect(400);
    });

    it('ISOLAMENTO: outro grupo ve lista vazia; este grupo nao ve o dos outros', async () => {
      const mine = await list('', other.token).expect(200);
      assert.deepEqual(mine.body, []);
      assert.equal(mine.headers['x-total-count'], '0');
      assert.deepEqual((await summary('', other.token).expect(200)).body, { students: 0, overdueCents: 0, overdueCount: 0 });
      // studentId alheio no filtro nao vaza nada.
      assert.deepEqual((await list(`?studentId=${d1}`, other.token).expect(200)).body, []);
    });

    it('POST /finance/mark-overdue (FinanceOverdueService existente) grava OVERDUE, avisa o aluno e NAO muda a lista', async () => {
      const mark = await api('post', '/finance/mark-overdue', delq.token).expect(201);
      // PENDING vencidos: d1(-5), d2(-1) e o avulso sem aluno. O vence-hoje e os pagos/cancelados ficam como estao.
      assert.deepEqual(mark.body, { marked: 3, notified: 1, hasMore: false });
      const states = await prisma.financialRecord.groupBy({
        by: ['status'],
        where: { organizationId: delq.organizationId },
        _count: { _all: true },
      });
      const count = (s: string) => states.find((x) => x.status === s)?._count._all ?? 0;
      assert.equal(count('OVERDUE'), 4); // 1 gravado + 3 marcados
      assert.equal(count('PENDING'), 2); // a vencer + vence hoje
      const notes = await prisma.notification.findMany({ where: { userId: aluno1UserId } });
      assert.equal(notes.length, 1);
      assert.equal(notes[0].type, 'FINANCE_OVERDUE');

      assert.deepEqual((await summary().expect(200)).body, { students: 2, overdueCents: 18000, overdueCount: 3 });
      const again = await api('post', '/finance/mark-overdue', delq.token).expect(201);
      assert.deepEqual(again.body, { marked: 0, notified: 0, hasMore: false });
      assert.equal(await prisma.notification.count({ where: { userId: aluno1UserId } }), 1, 'nao notifica duas vezes');
    });

    it('pagar o atrasado tira o aluno da lista; estornar o traz de volta', async () => {
      const recs = await prisma.financialRecord.findMany({ where: { organizationId: delq.organizationId, studentId: d2 } });
      const pend = recs[0];
      await api('post', `/finance/${pend.id}/pay`, delq.token).send({ paymentMethod: 'PIX' }).expect(200);
      assert.deepEqual((await summary().expect(200)).body, { students: 1, overdueCents: 15000, overdueCount: 2 });
      await api('post', `/finance/${pend.id}/refund`, delq.token).expect(200);
      assert.equal((await summary().expect(200)).body.students, 2);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('"Como pagar" (Organization.paymentInstructions)', () => {
    const text = 'PIX (CNPJ): 12.345.678/0001-90\nBanco X ag 0001 cc 12345-6\nEnvie o comprovante pelo WhatsApp.';

    it('MESTRE grava via PATCH /organizations/me; ALUNO le em GET /organizations; PROFESSOR/ALUNO nao editam', async () => {
      const res = await api('patch', '/organizations/me', main.token).send({ paymentInstructions: `  ${text}  ` }).expect(200);
      assert.equal(res.body.paymentInstructions, text, 'aparado');
      const row = await prisma.organization.findUniqueOrThrow({ where: { id: main.organizationId } });
      assert.equal(row.paymentInstructions, text);

      const seen = await api('get', '/organizations', alunoToken).expect(200);
      assert.equal(seen.body.paymentInstructions, text);
      assert.equal(seen.body.id, main.organizationId);

      await api('patch', '/organizations/me', professorToken).send({ paymentInstructions: 'hack' }).expect(403);
      await api('patch', '/organizations/me', alunoToken).send({ paymentInstructions: 'hack' }).expect(403);
      await api('patch', '/organizations/me', undefined).send({ paymentInstructions: 'hack' }).expect(401);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: main.organizationId } })).paymentInstructions, text);
    });

    it('nao quebra o DTO existente: campos antigos continuam funcionando junto, e corpo vazio continua 400', async () => {
      const res = await api('patch', '/organizations/me', main.token)
        .send({ description: 'Grupo de teste', paymentInstructions: 'So PIX: 62999990000' })
        .expect(200);
      assert.equal(res.body.description, 'Grupo de teste');
      assert.equal(res.body.paymentInstructions, 'So PIX: 62999990000');
      await api('patch', '/organizations/me', main.token).send({}).expect(400);
      await api('patch', '/organizations/me', main.token).send({ slug: 'novo' }).expect(400);
    });

    it('limite de 2000 caracteres (2001 => 400, 2000 ok) e tipo errado => 400', async () => {
      await api('patch', '/organizations/me', main.token).send({ paymentInstructions: 'x'.repeat(2001) }).expect(400);
      await api('patch', '/organizations/me', main.token).send({ paymentInstructions: 123 }).expect(400);
      await api('patch', '/organizations/me', main.token).send({ paymentInstructions: 'x'.repeat(2000) }).expect(200);
    });

    it('null ou texto em branco LIMPA; um grupo nao altera o do outro', async () => {
      await api('patch', '/organizations/me', other.token).send({ paymentInstructions: 'PIX do outro grupo' }).expect(200);
      await api('patch', '/organizations/me', main.token).send({ paymentInstructions: '   ' }).expect(200);
      assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: main.organizationId } })).paymentInstructions, null);
      assert.equal(
        (await prisma.organization.findUniqueOrThrow({ where: { id: other.organizationId } })).paymentInstructions,
        'PIX do outro grupo',
      );
      await api('patch', '/organizations/me', other.token).send({ paymentInstructions: null }).expect(200);
      const seen = await api('get', '/organizations', alunoToken).expect(200);
      assert.equal(seen.body.paymentInstructions, null);
    });
  });
});
