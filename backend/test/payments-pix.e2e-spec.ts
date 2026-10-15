import { INestApplication } from '@nestjs/common';
import { FinancialStatus, OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { PixService } from '../src/interface/http/payments/pix.service';
import { PAYMENT_PROVIDER } from '../src/shared/payments/payment-provider.interface';
import { StubPaymentProvider } from '../src/shared/payments/stub-payment.provider';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';

/**
 * Pix de mensalidade na conta Mercado Pago DO GRUPO (PLANO_PROJETO.md 10.52), de ponta a ponta com o provedor SIMULADO
 * (StubPaymentProvider, sem rede - PAYMENTS_PROVIDER=stub em test/env-setup.ts): conexao OAuth (state assinado, tokens
 * cifrados), Pix idempotente, dono do lancamento, isolamento entre grupos, webhook assinado (HMAC calculado AQUI, de
 * forma independente do servico), baixa unica pelo pay(), valor divergente/grupo errado sem baixa, reconciliacao e RBAC.
 * Segunda via independente = Prisma direto. Grupos proprios (createSecondOrg); o after() apaga tudo.
 */
const TAG = `${Date.now()}`;
const MAIL_DOMAIN = 'e2e-pix.local';
const WEBHOOK_SECRET = 'e2e-webhook-secret'; // o mesmo de test/env-setup.ts
const SELLER_MAIN = `77${TAG.slice(-7)}`;
const SELLER_OTHER = `78${TAG.slice(-7)}`;

describe('Pagamentos: Pix na conta Mercado Pago do grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  let stub: StubPaymentProvider;

  let main: SecondOrg;
  let other: SecondOrg;
  const extraUserIds: number[] = [];
  let professorToken: string;
  let monitorToken: string;
  let alunoToken: string;
  let guardianToken: string;
  let alunoStudentId: number;
  let dependentId: number;
  let strangerStudentId: number;
  let noEmailStudentId: number;
  const orgIds = (): number[] => [main.organizationId, other.organizationId];
  let notifSeq = 0;

  const api = (method: 'get' | 'post' | 'delete', path: string, token?: string) => {
    const req = request(server())[method](`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  async function makeMember(organizationId: number, role: OrgRole, kind: string) {
    const email = `${kind}-${TAG}@${MAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: `E2E-PIX ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    extraUserIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    const { token } = await loginAs(app, email);
    return { userId: user.id, token, email };
  }

  const mkStudent = (organizationId: number, name: string, extra: Record<string, unknown> = {}) =>
    prisma.student.create({ data: { organizationId, name: `E2E-PIX ${TAG} ${name}`, ...extra } });
  const mkRecord = (organizationId: number, studentId: number | null, amountCents = 15000) =>
    prisma.financialRecord.create({
      data: {
        organizationId,
        studentId,
        description: `E2E-PIX ${TAG} Mensalidade`,
        amountCents,
        status: FinancialStatus.PENDING,
        dueDate: new Date(`${todaySaoPaulo(10)}T00:00:00.000Z`),
      },
    });

  /** Webhook assinado como o Mercado Pago (manifesto + HMAC-SHA256 calculados aqui, independentes do servico). */
  function webhook(
    dataId: string,
    body: Record<string, unknown>,
    opts: { secret?: string; ts?: number; signature?: string | null } = {},
  ) {
    notifSeq += 1;
    const requestId = `req-${TAG}-${notifSeq}`;
    const ts = String(opts.ts ?? Date.now());
    const v1 = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    let req = request(server()).post(`/api/webhooks/mercadopago?data.id=${dataId}&type=payment`).set('x-request-id', requestId);
    if (opts.signature !== null) req = req.set('x-signature', opts.signature ?? `ts=${ts},v1=${v1}`);
    return req.send({ type: 'payment', action: 'payment.updated', data: { id: dataId }, ...body });
  }

  const paymentIdOf = async (recordId: number): Promise<string> => {
    const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recordId } });
    assert.ok(r.gatewayPaymentId, 'lancamento sem Pix gerado');
    return r.gatewayPaymentId;
  };

  /** connect + callback; devolve o `mp` do redirecionamento e o state usado. */
  async function connectRaw(org: SecondOrg, seller: string): Promise<{ mp: string | null; state: string }> {
    const res = await api('post', '/payments/mercadopago/connect', org.token).expect(200);
    const state = new URL(res.body.url).searchParams.get('state');
    assert.ok(state);
    const cb = await request(server()).get(`/api/payments/mercadopago/callback?code=ok-${seller}&state=${encodeURIComponent(state!)}`);
    assert.equal(cb.status, 302);
    return { mp: new URL(cb.headers.location).searchParams.get('mp'), state: state! };
  }

  async function connect(org: SecondOrg, seller: string) {
    const { mp, state } = await connectRaw(org, seller);
    assert.equal(mp, 'ok');
    return state;
  }

  const atProduction = async <T>(fn: () => Promise<T>, extra: Record<string, string> = {}): Promise<T> => {
    const saved: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV };
    for (const k of Object.keys(extra)) saved[k] = process.env[k];
    Object.assign(process.env, { NODE_ENV: 'production', ...extra });
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  before(async () => {
    app = await createTestApp({ disableThrottle: true });
    stub = app.get<StubPaymentProvider>(PAYMENT_PROVIDER);
    assert.ok(stub instanceof StubPaymentProvider, 'os testes exigem PAYMENTS_PROVIDER=stub');
    main = await createSecondOrg(app, prisma, `pix-main-${TAG}`);
    other = await createSecondOrg(app, prisma, `pix-other-${TAG}`);

    professorToken = (await makeMember(main.organizationId, OrgRole.PROFESSOR, 'professor')).token;
    monitorToken = (await makeMember(main.organizationId, OrgRole.MONITOR, 'monitor')).token;
    const aluno = await makeMember(main.organizationId, OrgRole.ALUNO, 'aluno');
    alunoToken = aluno.token;
    alunoStudentId = (await mkStudent(main.organizationId, 'Aluno', { userId: aluno.userId, email: aluno.email })).id;
    const guardian = await makeMember(main.organizationId, OrgRole.RESPONSAVEL, 'resp');
    guardianToken = guardian.token;
    dependentId = (await mkStudent(main.organizationId, 'Dependente')).id;
    await prisma.studentGuardian.create({
      data: { organizationId: main.organizationId, studentId: dependentId, userId: guardian.userId, name: 'Resp', email: guardian.email },
    });
    strangerStudentId = (await mkStudent(main.organizationId, 'Outro', { email: `outro-${TAG}@${MAIL_DOMAIN}` })).id;
    noEmailStudentId = (await mkStudent(main.organizationId, 'Sem email')).id;
  });

  after(async () => {
    const ids = orgIds();
    await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ organizationId: { in: ids } }, { eventId: { contains: TAG } }] } });
    const records = await prisma.financialRecord.findMany({ where: { organizationId: { in: ids } }, select: { gatewayPaymentId: true } });
    const paymentIds = records.map((r) => r.gatewayPaymentId).filter((p): p is string => !!p);
    await prisma.paymentWebhookEvent.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.paymentProviderAccount.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.paymentOauthState.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId: { in: ids } }, { userId: { in: extraUserIds } }] } });
    await prisma.financialRecord.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await other.cleanup();
    await main.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // -----------------------------------------------------------------------------------------------
  describe('conexao (OAuth do vendedor)', () => {
    it('status sem conexao: disponivel no servidor, nao conectado', async () => {
      const res = await api('get', '/payments/mercadopago/status', main.token).expect(200);
      assert.deepEqual(res.body, {
        provider: 'stub',
        available: true,
        connected: false,
        liveMode: false,
        providerUserId: null,
        connectedAt: null,
        status: 'NOT_CONNECTED',
      });
    });

    it('RBAC: sem token 401; PROFESSOR, MONITOR e ALUNO 403 em status/connect/disconnect', async () => {
      for (const [method, path] of [
        ['get', '/payments/mercadopago/status'],
        ['post', '/payments/mercadopago/connect'],
        ['delete', '/payments/mercadopago/disconnect'],
      ] as const) {
        await api(method, path).expect(401);
        await api(method, path, professorToken).expect(403);
        await api(method, path, monitorToken).expect(403);
        await api(method, path, alunoToken).expect(403);
      }
    });

    it('gerar Pix sem conta conectada => 409 MP_NOT_CONNECTED (nada criado no provedor)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId);
      const before = stub.createCalls.length;
      const res = await api('post', `/finance/${rec.id}/pix`, main.token).expect(409);
      assert.equal(res.body.code, 'MP_NOT_CONNECTED');
      assert.equal(stub.createCalls.length, before);
      await prisma.financialRecord.delete({ where: { id: rec.id } });
    });

    it('connect devolve a URL de autorizacao com state; callback com state invalido/adulterado/code recusado => mp=erro', async () => {
      const res = await api('post', '/payments/mercadopago/connect', main.token).expect(200);
      const state = new URL(res.body.url).searchParams.get('state')!;
      assert.match(state, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      const tampered = `${state.split('.')[0]}x.${state.split('.')[1]}`;
      for (const bad of ['', 'lixo', tampered, `${state}a`]) {
        const cb = await request(server()).get(`/api/payments/mercadopago/callback?code=ok-${SELLER_MAIN}&state=${encodeURIComponent(bad)}`);
        assert.equal(cb.status, 302);
        assert.equal(cb.headers.location, 'https://painel.e2e.test/financeiro?mp=erro');
      }
      const refused = await request(server()).get(`/api/payments/mercadopago/callback?code=bad-code&state=${encodeURIComponent(state)}`);
      assert.equal(refused.headers.location, 'https://painel.e2e.test/financeiro?mp=erro');
      assert.equal(await prisma.paymentProviderAccount.count({ where: { organizationId: main.organizationId } }), 0);
    });

    it('conta de TESTE (live_mode=false) em producao sem PAYMENTS_ALLOW_TEST_ACCOUNTS => mp=erro, nada gravado (B8)', async () => {
      const tokensBefore = stub.lastTokens;
      const mp = await atProduction(async () => (await connectRaw(main, SELLER_MAIN)).mp, { PAYMENTS_TOKEN_KEY: 'k'.repeat(48) });
      assert.equal(mp, 'erro');
      // O code FOI trocado (state valido e consumido): a recusa veio da conta de teste, nao de outra etapa.
      assert.notEqual(stub.lastTokens, tokensBefore);
      assert.equal(stub.lastTokens!.liveMode, false);
      assert.equal(await prisma.paymentProviderAccount.count({ where: { organizationId: main.organizationId } }), 0);
    });

    it('callback valido conecta: tokens CIFRADOS no banco e ausentes do status e da auditoria; state de USO UNICO', async () => {
      const state = await connect(main, SELLER_MAIN);
      // Reuso do MESMO state (replay) e recusado (M6).
      const replay = await request(server()).get(`/api/payments/mercadopago/callback?code=ok-${SELLER_MAIN}&state=${encodeURIComponent(state)}`);
      assert.equal(replay.headers.location, 'https://painel.e2e.test/financeiro?mp=erro');
      const tokens = stub.lastTokens!;
      const row = await prisma.paymentProviderAccount.findUniqueOrThrow({
        where: { organizationId_provider: { organizationId: main.organizationId, provider: 'stub' } },
      });
      assert.equal(row.status, 'CONNECTED');
      assert.equal(row.providerUserId, SELLER_MAIN);
      assert.match(row.accessTokenEnc!, /^v2:/);
      assert.match(row.refreshTokenEnc!, /^v2:/);
      assert.ok(!row.accessTokenEnc!.includes(tokens.accessToken));
      assert.ok(!row.refreshTokenEnc!.includes(tokens.refreshToken!));

      const status = await api('get', '/payments/mercadopago/status', main.token).expect(200);
      assert.equal(status.body.connected, true);
      assert.equal(status.body.status, 'CONNECTED');
      assert.equal(status.body.providerUserId, SELLER_MAIN);
      const text = JSON.stringify(status.body);
      assert.ok(!text.includes(tokens.accessToken) && !text.includes(tokens.refreshToken!) && !text.includes('v2:'));

      const audits = await prisma.auditLog.findMany({ where: { organizationId: main.organizationId, action: 'PAYMENT_ACCOUNT_CONNECT' } });
      assert.equal(audits.length, 1);
      assert.ok(!JSON.stringify(audits).includes(tokens.accessToken));

      await connect(other, SELLER_OTHER);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('Pix: gerar, reaproveitar, dono, isolamento', () => {
    let rec1: number;
    let recStranger: number;
    let recDep: number;
    let recOther: number;

    before(async () => {
      rec1 = (await mkRecord(main.organizationId, alunoStudentId)).id;
      recStranger = (await mkRecord(main.organizationId, strangerStudentId)).id;
      recDep = (await mkRecord(main.organizationId, dependentId, 9000)).id;
      recOther = (await mkRecord(other.organizationId, null)).id;
    });

    it('MESTRE gera o Pix (valor do servidor, referencia do grupo) e um 2o pedido REAPROVEITA o pendente', async () => {
      const before = stub.createCalls.length;
      const first = await api('post', `/finance/${rec1}/pix`, main.token).expect(200);
      assert.equal(first.body.financeRecordId, rec1);
      assert.equal(first.body.amountCents, 15000);
      assert.equal(first.body.status, 'PENDING');
      assert.ok(first.body.qrCode && first.body.qrCodeBase64 && first.body.ticketUrl);
      assert.ok(new Date(first.body.expiresAt).getTime() > Date.now() + 23 * 3600 * 1000);

      const again = await api('post', `/finance/${rec1}/pix`, main.token).expect(200);
      assert.equal(again.body.qrCode, first.body.qrCode);
      const mine = await api('post', `/finance/me/${rec1}/pix`, alunoToken).expect(200);
      assert.equal(mine.body.qrCode, first.body.qrCode);
      assert.equal(stub.createCalls.length, before + 1, 'so UMA cobranca no provedor');
      const call = stub.createCalls[stub.createCalls.length - 1];
      assert.equal(call.externalReference, `gingapp:${main.organizationId}:${rec1}`);
      assert.equal(call.amountCents, 15000);
      assert.equal(call.payerEmail, `aluno-${TAG}@${MAIL_DOMAIN}`);
      assert.match(call.idempotencyKey, new RegExp(`^gingapp-pix-${main.organizationId}-${rec1}-15000-1$`));

      const audit = await prisma.auditLog.count({ where: { organizationId: main.organizationId, action: 'PAYMENT_PIX_GENERATE', resourceId: String(rec1) } });
      assert.equal(audit, 1);
    });

    it('GET /finance e /finance/me trazem `pix` resumido e `paidVia`, sem copia-e-cola/ids do provedor', async () => {
      const list = await api('get', `/finance?studentId=${alunoStudentId}`, main.token).expect(200);
      const item = list.body.find((r: { id: number }) => r.id === rec1);
      assert.equal(item.pix.status, 'PENDING');
      assert.ok(item.pix.expiresAt && item.pix.generatedAt);
      assert.equal(item.paidVia, null);
      for (const key of ['pixQrCode', 'pixQrCodeBase64', 'gatewayPaymentId', 'gatewayStatus', 'pixSeq']) assert.ok(!(key in item), key);

      const me = await api('get', '/finance/me', alunoToken).expect(200);
      const mine = me.body.find((r: { id: number }) => r.id === rec1);
      assert.equal(mine.pix.status, 'PENDING');
      assert.ok(!('pixQrCode' in mine));
      const plain = me.body.find((r: { id: number }) => r.id !== rec1);
      assert.equal(plain?.pix ?? null, null);
    });

    it('aluno so alcanca o PROPRIO lancamento; responsavel gera o do dependente', async () => {
      await api('post', `/finance/me/${recStranger}/pix`, alunoToken).expect(404);
      await api('get', `/finance/me/${recStranger}/pix`, alunoToken).expect(404);
      await api('post', `/finance/me/${recOther}/pix`, alunoToken).expect(404);
      await api('post', `/finance/me/${recDep}/pix`, alunoToken).expect(404);
      // Rota de gestao: ALUNO sem permissao.
      await api('post', `/finance/${rec1}/pix`, alunoToken).expect(403);

      const dep = await api('post', `/finance/me/${recDep}/pix`, guardianToken).expect(200);
      assert.equal(dep.body.amountCents, 9000);
      assert.equal(stub.createCalls[stub.createCalls.length - 1].payerEmail, `resp-${TAG}@${MAIL_DOMAIN}`);
      await api('get', `/finance/me/${recDep}/pix`, guardianToken).expect(200);
      assert.equal(await prisma.financialRecord.count({ where: { id: recStranger, gatewayPaymentId: { not: null } } }), 0);
    });

    it('outro grupo nao alcanca (404) e PROFESSOR/MONITOR nao geram (403)', async () => {
      await api('post', `/finance/${rec1}/pix`, other.token).expect(404);
      await api('get', `/finance/${rec1}/pix`, other.token).expect(404);
      await api('post', `/finance/${recOther}/pix`, main.token).expect(404);
      await api('post', `/finance/${rec1}/pix`, professorToken).expect(403);
      await api('post', `/finance/${rec1}/pix`, monitorToken).expect(403);
    });

    it('sem e-mail de aluno/responsavel nem fallback => 422 PAYER_EMAIL_REQUIRED; GET sem Pix => 404 PIX_NOT_FOUND', async () => {
      const rec = await mkRecord(main.organizationId, noEmailStudentId);
      const res = await api('post', `/finance/${rec.id}/pix`, main.token).expect(422);
      assert.equal(res.body.code, 'PAYER_EMAIL_REQUIRED');
      const none = await api('get', `/finance/${rec.id}/pix`, main.token).expect(404);
      assert.equal(none.body.code, 'PIX_NOT_FOUND');
    });

    it('ja pago => 409 ALREADY_PAID; cancelado => 409 RECORD_NOT_PAYABLE; abaixo do minimo => 422 AMOUNT_TOO_LOW', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId);
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { status: FinancialStatus.PAID, paidAt: new Date() } });
      const res = await api('post', `/finance/${rec.id}/pix`, main.token).expect(409);
      assert.equal(res.body.code, 'ALREADY_PAID');
      const cancelled = await mkRecord(main.organizationId, alunoStudentId);
      await prisma.financialRecord.update({ where: { id: cancelled.id }, data: { status: FinancialStatus.CANCELLED } });
      assert.equal((await api('post', `/finance/${cancelled.id}/pix`, main.token).expect(409)).body.code, 'RECORD_NOT_PAYABLE');
      const tiny = await mkRecord(main.organizationId, alunoStudentId, 50);
      assert.equal((await api('post', `/finance/${tiny.id}/pix`, main.token).expect(422)).body.code, 'AMOUNT_TOO_LOW');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('webhook e baixa automatica', () => {
    let recPaid: number;
    let paymentId: string;

    before(async () => {
      recPaid = (await mkRecord(main.organizationId, alunoStudentId, 12345)).id;
      await api('post', `/finance/${recPaid}/pix`, main.token).expect(200);
      paymentId = await paymentIdOf(recPaid);
    });

    it('assinatura ausente/errada/antiga => 401 e nada muda', async () => {
      stub.setStatus(paymentId, 'APPROVED');
      for (const res of [
        await webhook(paymentId, { id: `n-${TAG}-a`, user_id: SELLER_MAIN }, { signature: null }),
        await webhook(paymentId, { id: `n-${TAG}-b`, user_id: SELLER_MAIN }, { secret: 'segredo-errado' }),
        await webhook(paymentId, { id: `n-${TAG}-c`, user_id: SELLER_MAIN }, { ts: Date.now() - 60 * 60 * 1000 }),
        await webhook(paymentId, { id: `n-${TAG}-d`, user_id: SELLER_MAIN }, { signature: 'ts=1,v1=zz' }),
      ]) {
        assert.equal(res.status, 401);
        assert.equal(res.body.code, 'INVALID_SIGNATURE');
      }
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PENDING);
    });

    it('approved valido da baixa UMA vez (PIX, PIX_AUTO, recibo, avisos); reentrega e outra notificacao nao duplicam', async () => {
      const res = await webhook(paymentId, { id: `n-${TAG}-1`, user_id: SELLER_MAIN }).expect(200);
      assert.equal(res.body.outcome, 'PAID');

      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PAID);
      assert.equal(r.paymentMethod, 'PIX');
      assert.equal(r.paidVia, 'PIX_AUTO');
      assert.equal(r.paidCents, 12345);
      assert.equal(r.gatewayPaymentId, paymentId);
      assert.ok(r.paidAt);

      const receipt = await api('get', `/finance/${recPaid}/receipt`, main.token).expect(200);
      assert.equal(receipt.body.paymentMethod, 'PIX');
      assert.equal(receipt.body.paidCents, 12345);

      // Reentrega da MESMA notificacao e outra notificacao do mesmo pagamento.
      assert.equal((await webhook(paymentId, { id: `n-${TAG}-1`, user_id: SELLER_MAIN }).expect(200)).body.outcome, 'DUPLICATE');
      assert.equal((await webhook(paymentId, { id: `n-${TAG}-2`, user_id: SELLER_MAIN }).expect(200)).body.outcome, 'DUPLICATE');

      assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: String(recPaid) } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'PAYMENT_PIX_CONFIRMED', resourceId: String(recPaid) } }), 1);
      const alunoUser = await prisma.student.findUniqueOrThrow({ where: { id: alunoStudentId }, select: { userId: true } });
      assert.equal(await prisma.notification.count({ where: { userId: alunoUser.userId!, type: 'FINANCE_PAYMENT_CONFIRMED' } }), 1);
      assert.equal(await prisma.notification.count({ where: { userId: main.userId, type: 'FINANCE_PIX_RECEIVED' } }), 1);

      const me = await api('get', '/finance/me', alunoToken).expect(200);
      const item = me.body.find((x: { id: number }) => x.id === recPaid);
      assert.equal(item.paidVia, 'PIX_AUTO');
      assert.equal(item.pix.status, 'PAID');
      const pix = await api('get', `/finance/me/${recPaid}/pix`, alunoToken).expect(200);
      assert.equal(pix.body.status, 'PAID');
      assert.equal(pix.body.qrCode, null);
    });

    it('PATCH nao desfaz baixa do Pix (409 RECORD_PAID_VIA_PIX); formulario desatualizado => 409 RECORD_CHANGED; DELETE => 409 RECORD_HAS_PIX (A2/M3)', async () => {
      const patch = (body: Record<string, unknown>) =>
        request(server()).patch(`/api/finance/${recPaid}`).set('Authorization', `Bearer ${main.token}`).send(body);
      const paid = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      const back = await patch({ status: 'PENDING', description: 'x' }).expect(409);
      assert.equal(back.body.code, 'RECORD_PAID_VIA_PIX');
      assert.equal((await patch({ amountCents: 999 }).expect(409)).body.code, 'RECORD_PAID_VIA_PIX');
      const stale = await patch({ description: 'editado', expectedUpdatedAt: new Date(paid.updatedAt.getTime() - 60_000).toISOString() }).expect(409);
      assert.equal(stale.body.code, 'RECORD_CHANGED');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PAID);
      assert.equal(r.paidVia, 'PIX_AUTO');
      assert.equal(r.description, paid.description);
      // Edicao inofensiva com o updatedAt certo passa (e nao troca a data da baixa).
      await patch({ description: paid.description, status: 'PAID', expectedUpdatedAt: paid.updatedAt.toISOString() }).expect(200);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } })).paidAt!.getTime(), paid.paidAt!.getTime());
      assert.equal((await api('delete', `/finance/${recPaid}`, main.token).expect(409)).body.code, 'RECORD_HAS_PIX');
    });

    it('corrida webhook x consulta do MESMO pagamento: uma baixa, uma auditoria, um aviso (B7)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 4321);
      await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'APPROVED');
      const payment = await stub.getPayment({ accessToken: `stub-access-${SELLER_MAIN}-x`, paymentId: pid });
      const pix = app.get(PixService);
      const outcomes = await Promise.all(
        [0, 1, 2].map(() => pix.applyProviderPayment(main.organizationId, payment, { source: 'SYNC', providerUserId: SELLER_MAIN })),
      );
      assert.equal(outcomes.filter((o) => o.outcome === 'PAID').length, 1, JSON.stringify(outcomes));
      assert.equal(await prisma.auditLog.count({ where: { action: 'PAYMENT_PIX_CONFIRMED', resourceId: String(rec.id) } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: String(rec.id) } }), 1);
      const n = await prisma.notification.count({ where: { userId: main.userId, type: 'FINANCE_PIX_RECEIVED', body: { contains: '43,21' } } });
      assert.equal(n, 1);
    });

    it('pagamento de TESTE em producao nunca da baixa (TEST_MODE, B8)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 3000);
      const pid = stub.seedPayment({ sellerUserId: SELLER_MAIN, amountCents: 3000, externalReference: `gingapp:${main.organizationId}:${rec.id}` });
      const payment = await stub.getPayment({ accessToken: `stub-access-${SELLER_MAIN}-x`, paymentId: pid });
      const { outcome } = await atProduction(() =>
        app.get(PixService).applyProviderPayment(main.organizationId, payment, { source: 'SYNC', providerUserId: SELLER_MAIN }),
      );
      assert.equal(outcome, 'TEST_MODE');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).status, FinancialStatus.PENDING);
    });

    it('pagamento aprovado de lancamento APAGADO alerta o Mestre uma vez (ORPHAN_PAID, M3)', async () => {
      const ghostId = 2_000_000_000 + Number(TAG.slice(-6));
      const pid = stub.seedPayment({ sellerUserId: SELLER_MAIN, amountCents: 5500, externalReference: `gingapp:${main.organizationId}:${ghostId}` });
      assert.equal((await webhook(pid, { user_id: SELLER_MAIN }).expect(200)).body.outcome, 'ORPHAN_PAID');
      await webhook(pid, { user_id: SELLER_MAIN }).expect(200);
      assert.equal(await prisma.auditLog.count({ where: { action: 'PAYMENT_PIX_ALERT', resourceId: String(ghostId) } }), 1);
      assert.ok((await prisma.notification.count({ where: { userId: main.userId, type: 'FINANCE_PIX_ALERT', body: { contains: String(ghostId) } } })) === 1);
    });

    it('cancelar lancamento e baixa manual cancelam o Pix aberto NO PROVEDOR (M3); DELETE com Pix aberto => 409', async () => {
      const a = await mkRecord(main.organizationId, alunoStudentId, 2500);
      await api('post', `/finance/${a.id}/pix`, main.token).expect(200);
      const pa = await paymentIdOf(a.id);
      assert.equal((await api('delete', `/finance/${a.id}`, main.token).expect(409)).body.code, 'RECORD_HAS_PIX');
      await api('post', `/finance/${a.id}/cancel`, main.token).expect(200);
      const token = `stub-access-${SELLER_MAIN}-x`;
      assert.equal((await stub.getPayment({ accessToken: token, paymentId: pa })).status, 'CANCELLED');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: a.id } })).gatewayStatus, 'cancelled');
      await api('delete', `/finance/${a.id}`, main.token).expect(200); // Pix encerrado: pode apagar

      const b = await mkRecord(main.organizationId, alunoStudentId, 2600);
      await api('post', `/finance/${b.id}/pix`, main.token).expect(200);
      const pb = await paymentIdOf(b.id);
      await request(server()).post(`/api/finance/${b.id}/pay`).set('Authorization', `Bearer ${main.token}`).send({ paymentMethod: 'CASH' }).expect(200);
      assert.equal((await stub.getPayment({ accessToken: token, paymentId: pb })).status, 'CANCELLED');
    });

    it('estorno manual + nova notificacao do MESMO pagamento: nao baixa de novo (ALREADY_APPLIED)', async () => {
      await api('post', `/finance/${recPaid}/refund`, main.token).expect(200);
      // O estorno limpou o Pix do lancamento; o grupo e achado pelo user_id e o pagamento aponta para o lancamento,
      // mas ja foi aplicado uma vez (evento outcome PAID).
      const res = await webhook(paymentId, { id: `n-${TAG}-3`, user_id: SELLER_MAIN }).expect(200);
      assert.equal(res.body.outcome, 'ALREADY_APPLIED');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(r.paidVia, null);
    });

    it('valor divergente nao da baixa e alerta o Mestre (uma vez)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 20000);
      const forged = stub.seedPayment({ sellerUserId: SELLER_MAIN, amountCents: 100, externalReference: `gingapp:${main.organizationId}:${rec.id}` });
      const res = await webhook(forged, { id: `n-${TAG}-4`, user_id: SELLER_MAIN }).expect(200);
      assert.equal(res.body.outcome, 'AMOUNT_MISMATCH');
      await webhook(forged, { id: `n-${TAG}-5`, user_id: SELLER_MAIN }).expect(200);
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(await prisma.auditLog.count({ where: { action: 'PAYMENT_PIX_ALERT', resourceId: String(rec.id) } }), 1);
      assert.ok((await prisma.notification.count({ where: { userId: main.userId, type: 'FINANCE_PIX_ALERT' } })) >= 1);
    });

    it('pagamento de OUTRO grupo apontando para lancamento deste nao baixa (referencia/vendedor conferidos)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 5000);
      // Pagamento real na conta do OUTRO grupo, com a referencia forjada para o lancamento do grupo principal.
      const foreign = stub.seedPayment({ sellerUserId: SELLER_OTHER, amountCents: 5000, externalReference: `gingapp:${main.organizationId}:${rec.id}` });
      const a = await webhook(foreign, { id: `n-${TAG}-6`, user_id: SELLER_OTHER }).expect(200);
      assert.equal(a.body.outcome, 'UNRESOLVED');
      // user_id "mentindo" (vendedor do grupo principal): o token dele nao enxerga o pagamento do outro vendedor.
      const b = await webhook(foreign, { id: `n-${TAG}-7`, user_id: SELLER_MAIN }).expect(200);
      assert.equal(b.body.outcome, 'UNRESOLVED');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PENDING);
    });

    it('cancelado/recusado libera um NOVO Pix', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 7000);
      const first = await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'CANCELLED');
      assert.equal((await webhook(pid, { id: `n-${TAG}-8`, user_id: SELLER_MAIN }).expect(200)).body.outcome, 'CANCELLED');
      const view = await api('get', `/finance/${rec.id}/pix`, main.token).expect(200);
      assert.equal(view.body.status, 'CANCELLED');
      const second = await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      assert.equal(second.body.status, 'PENDING');
      assert.notEqual(second.body.qrCode, first.body.qrCode);
      assert.notEqual(await paymentIdOf(rec.id), pid);
    });

    it('valor do lancamento alterado: o Pix antigo e cancelado no provedor e um novo e gerado com o valor novo', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 8000);
      await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const oldPid = await paymentIdOf(rec.id);
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { amountCents: 8500 } });
      const res = await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      assert.equal(res.body.amountCents, 8500);
      assert.notEqual(await paymentIdOf(rec.id), oldPid);
      // O antigo foi cancelado no provedor (pagador nunca fica com dois Pix validos).
      const conn = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { organizationId: main.organizationId } });
      assert.equal(conn.status, 'CONNECTED');
      stub.setStatus(oldPid, 'APPROVED'); // mesmo que o provedor ainda aprovasse o antigo, o valor nao confere:
      assert.equal((await webhook(oldPid, { id: `n-${TAG}-9`, user_id: SELLER_MAIN }).expect(200)).body.outcome, 'AMOUNT_MISMATCH');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('reconciliacao e desconexao', () => {
    it('reconciliacao baixa um Pix aprovado cujo webhook se perdeu', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 6000);
      await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'APPROVED');
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixGeneratedAt: new Date(Date.now() - 20 * 60 * 1000) } });
      const stats = await app.get(PixService).reconcilePending();
      assert.ok(stats.paid >= 1);
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PAID);
      assert.equal(r.paidVia, 'PIX_AUTO');
      // Rodar de novo nao mexe (ja pago sai da fila).
      await app.get(PixService).reconcilePending();
      assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: String(rec.id) } }), 1);
    });

    it('token perto de vencer e renovado no uso; refresh recusado => conta ERROR, aviso ao Mestre e MP_ACCOUNT_ERROR', async () => {
      const student = await mkStudent(other.organizationId, 'Aluno outro', { email: `aluno-outro-${TAG}@${MAIL_DOMAIN}` });
      const where = { organizationId_provider: { organizationId: other.organizationId, provider: 'stub' } };
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const before = await prisma.paymentProviderAccount.update({ where, data: { tokenExpiresAt: soon } });

      const ok = await mkRecord(other.organizationId, student.id);
      await api('post', `/finance/${ok.id}/pix`, other.token).expect(200);
      const renewed = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      assert.notEqual(renewed.accessTokenEnc, before.accessTokenEnc);
      assert.ok(renewed.tokenExpiresAt!.getTime() > soon.getTime() + 30 * 24 * 60 * 60 * 1000);
      assert.equal(renewed.status, 'CONNECTED');

      await prisma.paymentProviderAccount.update({ where, data: { tokenExpiresAt: soon } });
      stub.failNextRefresh = 'INVALID_GRANT';
      const bad = await mkRecord(other.organizationId, student.id);
      const res = await api('post', `/finance/${bad.id}/pix`, other.token).expect(409);
      assert.equal(res.body.code, 'MP_ACCOUNT_ERROR');
      const failed = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      assert.equal(failed.status, 'ERROR');
      assert.equal(await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } }), 1);
      const status = await api('get', '/payments/mercadopago/status', other.token).expect(200);
      assert.equal(status.body.connected, false);
      assert.equal(status.body.status, 'ERROR');
      // Reconectar volta a CONNECTED.
      await connect(other, SELLER_OTHER);
      assert.equal((await prisma.paymentProviderAccount.findUniqueOrThrow({ where })).status, 'CONNECTED');
    });

    it('conta em ERROR + Pix aprovado: webhook 503 sem processar, reconciliacao NAO vence sem o provedor; reconectada, da a baixa (A1)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 6100);
      await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'APPROVED');
      const where = { organizationId_provider: { organizationId: main.organizationId, provider: 'stub' } };
      await prisma.paymentProviderAccount.update({ where, data: { status: 'ERROR' } });
      // Pix ja vencido ha horas (pior caso para o vencimento local) e gerado ha 20 min.
      await prisma.financialRecord.update({
        where: { id: rec.id },
        data: { pixGeneratedAt: new Date(Date.now() - 20 * 60 * 1000), pixExpiresAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      });

      const res = await webhook(pid, { user_id: SELLER_MAIN }).expect(503);
      assert.equal(res.body.code, 'PAYMENTS_ACCOUNT_UNAVAILABLE');
      const events = await prisma.paymentWebhookEvent.findMany({ where: { paymentId: pid, source: 'WEBHOOK' } });
      assert.equal(events.length, 1);
      assert.equal(events[0].processedAt, null);

      const stats = await app.get(PixService).reconcilePending();
      assert.ok(stats.unavailable >= 1);
      let r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(r.gatewayStatus, 'pending', 'nunca vence localmente sem resposta do provedor');
      assert.ok(r.pixLastCheckedAt, 'a conferencia avanca a fila');

      await connect(main, SELLER_MAIN); // reconecta a MESMA conta
      const later = await app.get(PixService).reconcilePending(new Date(Date.now() + 6 * 60 * 1000));
      assert.ok(later.paid >= 1);
      r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PAID);
      assert.equal(r.paidVia, 'PIX_AUTO');
    });

    it('GET /pix confere no provedor tambem o Pix EXPIRADO recente (pagamento no ultimo minuto, A1-c)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 6200);
      await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'APPROVED');
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixExpiresAt: new Date(Date.now() - 60 * 60 * 1000) } });
      const view = await api('get', `/finance/${rec.id}/pix`, main.token).expect(200);
      assert.equal(view.body.status, 'PAID');
    });

    it('troca para OUTRA conta com Pix aberto e recusada (mp=pix-aberto); sem Pix aberto troca e avisa os Mestres (A1-d/M6)', async () => {
      const open = await prisma.financialRecord.findMany({
        where: { organizationId: other.organizationId, gatewayStatus: 'pending', status: { in: ['PENDING', 'OVERDUE'] }, pixExpiresAt: { gt: new Date() } },
      });
      assert.ok(open.length >= 1, 'o grupo "other" tem Pix aberto (teste do token)');
      const NEW_SELLER = `79${TAG.slice(-7)}`;
      assert.equal((await connectRaw(other, NEW_SELLER)).mp, 'pix-aberto');
      const acc = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { organizationId: other.organizationId } });
      assert.equal(acc.providerUserId, SELLER_OTHER);

      for (const r of open) await api('post', `/finance/${r.id}/cancel`, other.token).expect(200);
      assert.equal((await connectRaw(other, NEW_SELLER)).mp, 'ok');
      assert.equal(await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED' } }), 1);
      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: other.organizationId, action: 'PAYMENT_ACCOUNT_CONNECT' },
        orderBy: { id: 'desc' },
      });
      assert.ok(JSON.stringify(audit).includes('previousProviderUserId'));
    });

    it('token ilegivel (chave trocada/adulterado) => conta ERROR + aviso ao Mestre + MP_ACCOUNT_ERROR (A1-e)', async () => {
      const where = { organizationId_provider: { organizationId: other.organizationId, provider: 'stub' } };
      const before = await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } });
      const acc = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      const parts = acc.accessTokenEnc!.split(':');
      parts[3] = Buffer.from('lixo').toString('base64');
      await prisma.paymentProviderAccount.update({ where, data: { accessTokenEnc: parts.join(':') } });
      const student = await mkStudent(other.organizationId, 'Aluno chave', { email: `aluno-chave-${TAG}@${MAIL_DOMAIN}` });
      const rec = await mkRecord(other.organizationId, student.id);
      assert.equal((await api('post', `/finance/${rec.id}/pix`, other.token).expect(409)).body.code, 'MP_ACCOUNT_ERROR');
      assert.equal((await prisma.paymentProviderAccount.findUniqueOrThrow({ where })).status, 'ERROR');
      assert.equal(await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } }), before + 1);
    });

    it('export LGPD do aluno traz os lancamentos pela view publica (sem QR/ids do provedor, B13)', async () => {
      const res = await api('get', '/auth/me/export', alunoToken).expect(200);
      const text = JSON.stringify(res.body);
      assert.ok(text.includes('"pix":{'), 'traz o resumo do Pix');
      for (const raw of ['pixQrCode', 'pixQrCodeBase64', 'gatewayPaymentId', 'gatewayStatus', 'STUBPIX']) assert.ok(!text.includes(raw), raw);
    });

    it('desconectar cancela no provedor os Pix pagaveis, apaga os tokens (REVOKED) e gerar Pix volta a dar MP_NOT_CONNECTED', async () => {
      const open = await prisma.financialRecord.findMany({
        where: { organizationId: main.organizationId, gatewayStatus: 'pending', status: { in: ['PENDING', 'OVERDUE'] }, pixExpiresAt: { gt: new Date() } },
      });
      assert.ok(open.length >= 1, 'ha Pix aberto antes de desconectar');
      const res = await api('delete', '/payments/mercadopago/disconnect', main.token).expect(200);
      for (const r of open) {
        assert.equal((await stub.getPayment({ accessToken: `stub-access-${SELLER_MAIN}-x`, paymentId: r.gatewayPaymentId! })).status, 'CANCELLED');
        assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: r.id } })).gatewayPaymentId, r.gatewayPaymentId, 'id mantido');
      }
      assert.equal(res.body.connected, false);
      assert.equal(res.body.status, 'REVOKED');
      const row = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { organizationId: main.organizationId } });
      assert.equal(row.accessTokenEnc, null);
      assert.equal(row.refreshTokenEnc, null);
      const rec = await mkRecord(main.organizationId, alunoStudentId);
      const gen = await api('post', `/finance/me/${rec.id}/pix`, alunoToken).expect(409);
      assert.equal(gen.body.code, 'MP_NOT_CONNECTED');
    });
  });
});
