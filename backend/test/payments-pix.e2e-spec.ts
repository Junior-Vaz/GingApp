import { INestApplication, Logger } from '@nestjs/common';
import { FinancialStatus, OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { PaymentAccountService } from '../src/interface/http/payments/payment-account.service';
import { PixService } from '../src/interface/http/payments/pix.service';
import { PAYMENT_PROVIDER } from '../src/shared/payments/payment-provider.interface';
import { StubPaymentProvider } from '../src/shared/payments/stub-payment.provider';
import { encryptTwoFactorSecret } from '../src/shared/security/two-factor-crypto';
import { generateTotpSecret, totpCode } from '../src/shared/security/totp';
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
// Modo MANUAL (10.55): valores FICTICIOS no formato do MP (o stub deriva o vendedor do numero final do token).
const SELLER_MANUAL = `76${TAG.slice(-7)}`;
const SELLER_MANUAL_2 = `75${TAG.slice(-7)}`;
const MANUAL_TOKEN = `APP_USR-e2e${TAG}-abcdef-${SELLER_MANUAL}`;
const MANUAL_TOKEN_2 = `APP_USR-e2e${TAG}-zzzzzz-${SELLER_MANUAL_2}`;
const MANUAL_HOOK_SECRET = `e2e-hook-manual-${TAG}`;
const MANUAL_PUBLIC_KEY = `APP_USR-pk-e2e-${TAG}`;
/** Vendedor para o qual o grupo "other" troca (OAuth) na reconciliacao/desconexao. */
const SELLER_NEW = `79${TAG.slice(-7)}`;
/** Chave dos tokens FICTICIA (10.56, M2): definida "depois" no meio do teste. */
const TOKEN_KEY_LATER = `e2e-token-key-${TAG}-`.padEnd(64, 'k');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** OAuth OPCIONAL: so com estas envs (ficticias; nunca credenciais reais). Ligadas no before() e restauradas no after(). */
const OAUTH_ENV: Record<string, string> = {
  MERCADOPAGO_CLIENT_ID: 'e2e-client-id',
  MERCADOPAGO_CLIENT_SECRET: 'e2e-client-secret-ficticio',
  MERCADOPAGO_REDIRECT_URI: 'https://painel.e2e.test/api/payments/mercadopago/callback',
};

/** Roda `fn` com envs trocadas (valor undefined = remove) e restaura depois. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Captura TUDO o que os servicos mandam ao Logger do Nest (o logger de teste do Nest silencia log/warn, entao o
 * prototype e interceptado) + stdout/stderr durante `fn` - prova de que token/segredo nao vao para o log.
 */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };
  const methods = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
  const proto = Logger.prototype as unknown as Record<string, (...args: unknown[]) => void>;
  const saved = methods.map((m) => proto[m]);
  for (const m of methods) {
    const original = proto[m];
    proto[m] = function (this: unknown, ...args: unknown[]) {
      chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      return original.apply(this, args);
    };
  }
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, output: chunks.join('\n') };
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
    methods.forEach((m, i) => (proto[m] = saved[i]));
  }
}

describe('Pagamentos: Pix na conta Mercado Pago do grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  let stub: StubPaymentProvider;

  let main: SecondOrg;
  let other: SecondOrg;
  let manual: SecondOrg;
  const savedOauthEnv: Record<string, string | undefined> = {};
  const extraUserIds: number[] = [];
  let professorToken: string;
  let monitorToken: string;
  let alunoToken: string;
  let guardianToken: string;
  let alunoStudentId: number;
  let dependentId: number;
  let strangerStudentId: number;
  let noEmailStudentId: number;
  const orgIds = (): number[] => [main.organizationId, other.organizationId, manual.organizationId];
  let notifSeq = 0;

  const api = (method: 'get' | 'post' | 'put' | 'delete', path: string, token?: string) => {
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
    opts: { secret?: string; ts?: number; signature?: string | null; org?: number | string } = {},
  ) {
    notifSeq += 1;
    const requestId = `req-${TAG}-${notifSeq}`;
    const ts = String(opts.ts ?? Date.now());
    const v1 = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    const org = opts.org !== undefined ? `&org=${opts.org}` : '';
    let req = request(server())
      .post(`/api/webhooks/mercadopago?data.id=${dataId}&type=payment${org}`)
      .set('x-request-id', requestId);
    if (opts.signature !== null) req = req.set('x-signature', opts.signature ?? `ts=${ts},v1=${v1}`);
    // eventId = o id que o servico grava (data.id + x-request-id): a 2a via le o resultado no banco (B2: a resposta e
    // constante e nao traz mais `outcome`).
    return Object.assign(req.send({ type: 'payment', action: 'payment.updated', data: { id: dataId }, ...body }), {
      eventId: `payment:${dataId}:request:${requestId}`,
    });
  }

  type Hook = ReturnType<typeof webhook>;
  /** Linha do evento gravada para a notificacao (null = nada gravado). */
  const eventOf = (hook: Hook) =>
    prisma.paymentWebhookEvent.findUnique({ where: { provider_eventId: { provider: 'stub', eventId: hook.eventId } } });
  /**
   * Envia, confere o status HTTP e a resposta CONSTANTE `{ received: true }` (B2) e devolve o `outcome` gravado no banco
   * (null = o servico nao gravou nada - ex.: gatilho que nao resolveu a nada, M5-a).
   */
  async function hookOutcome(hook: Hook, status = 200): Promise<string | null> {
    const res = await hook;
    assert.equal(res.status, status, JSON.stringify(res.body));
    if (status === 200) assert.deepEqual(res.body, { received: true });
    return (await eventOf(hook))?.outcome ?? null;
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
    // OAuth (opcional) ligado para os testes do fluxo OAuth; o modo MANUAL e testado tambem SEM estas envs.
    for (const [k, v] of Object.entries(OAUTH_ENV)) {
      savedOauthEnv[k] = process.env[k];
      process.env[k] = v;
    }
    app = await createTestApp({ disableThrottle: true });
    stub = app.get<StubPaymentProvider>(PAYMENT_PROVIDER);
    assert.ok(stub instanceof StubPaymentProvider, 'os testes exigem PAYMENTS_PROVIDER=stub');
    main = await createSecondOrg(app, prisma, `pix-main-${TAG}`);
    other = await createSecondOrg(app, prisma, `pix-other-${TAG}`);
    manual = await createSecondOrg(app, prisma, `pix-manual-${TAG}`);

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
    await manual.cleanup();
    await other.cleanup();
    await main.cleanup();
    await prisma.$disconnect();
    await app.close();
    for (const [k, v] of Object.entries(savedOauthEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // -----------------------------------------------------------------------------------------------
  describe('conexao (OAuth do vendedor)', () => {
    it('status sem conexao: disponivel no servidor, nao conectado (contrato 10.55 completo)', async () => {
      const res = await api('get', '/payments/mercadopago/status', main.token).expect(200);
      assert.deepEqual(res.body, {
        provider: 'stub',
        available: true,
        oauthAvailable: true,
        mode: null,
        connected: false,
        liveMode: false,
        providerUserId: null,
        connectedAt: null,
        status: 'NOT_CONNECTED',
        tokenHint: null,
        publicKey: null,
        hasWebhookSecret: false,
        webhookSecretReadable: true,
        webhookUrl: `https://painel.e2e.test/api/webhooks/mercadopago?org=${main.organizationId}`,
        lastError: null,
      });
    });

    it('RBAC: sem token 401; PROFESSOR, MONITOR e ALUNO 403 em status/credentials/connect/disconnect', async () => {
      for (const [method, path] of [
        ['get', '/payments/mercadopago/status'],
        ['put', '/payments/mercadopago/credentials'],
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

    it('B5: conta OAUTH nao aceita segredo de webhook proprio (409 WEBHOOK_SECRET_NOT_SUPPORTED); chave publica sim, sem senha', async () => {
      const res = await api('put', '/payments/mercadopago/credentials', main.token).send({ webhookSecret: 'x-y-z' }).expect(409);
      assert.equal(res.body.code, 'WEBHOOK_SECRET_NOT_SUPPORTED');
      const row = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { organizationId: main.organizationId } });
      assert.equal(row.webhookSecretEnc, null);
      const ok = await api('put', '/payments/mercadopago/credentials', main.token).send({ publicKey: 'TEST-pk-oauth' }).expect(200);
      assert.equal(ok.body.publicKey, 'TEST-pk-oauth');
      assert.equal(ok.body.hasWebhookSecret, false);
      assert.equal(ok.body.mode, 'OAUTH');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('modo MANUAL (10.55): credenciais da conta do grupo coladas no painel', () => {
    /**
     * PUT /credentials. Com `accessToken` manda a senha do Mestre (reautenticacao - 10.56, M6), salvo se o corpo ja
     * trouxer `currentPassword` (inclusive `undefined`, que o JSON omite: o caso "sem senha").
     */
    const credentials = (body: Record<string, unknown>, token = manual.token) =>
      api('put', '/payments/mercadopago/credentials', token).send(
        'accessToken' in body && !('currentPassword' in body) ? { ...body, currentPassword: DEV_PASSWORD } : body,
      );
    let mestre2: { userId: number; token: string };
    const accountRow = () =>
      prisma.paymentProviderAccount.findUnique({
        where: { organizationId_provider: { organizationId: manual.organizationId, provider: 'stub' } },
      });
    let manualStudentId: number;
    /** Lancamento + Pix gerado na conta MANUAL; devolve id do lancamento e do pagamento. */
    const manualPix = async (amountCents: number) => {
      const rec = await mkRecord(manual.organizationId, manualStudentId, amountCents);
      await api('post', `/finance/${rec.id}/pix`, manual.token).expect(200);
      return { recordId: rec.id, paymentId: await paymentIdOf(rec.id) };
    };
    const noOauthNoGlobalSecret = {
      MERCADOPAGO_CLIENT_ID: undefined,
      MERCADOPAGO_CLIENT_SECRET: undefined,
      MERCADOPAGO_REDIRECT_URI: undefined,
      MERCADOPAGO_WEBHOOK_SECRET: undefined,
    };

    before(async () => {
      manualStudentId = (await mkStudent(manual.organizationId, 'Aluno manual', { email: `aluno-manual-${TAG}@${MAIL_DOMAIN}` })).id;
      // Segundo Mestre: todos os Mestres sao avisados quando o token e definido/trocado (M6).
      mestre2 = await makeMember(manual.organizationId, OrgRole.MESTRE, 'mestre2');
    });

    it('OAuth dormente SEM env nenhuma do MP: oauthAvailable=false, POST /connect => 409 OAUTH_UNAVAILABLE (nada gravado)', async () => {
      await withEnv(noOauthNoGlobalSecret, async () => {
        const status = await api('get', '/payments/mercadopago/status', manual.token).expect(200);
        assert.equal(status.body.available, true, 'disponivel sem credencial nenhuma no ambiente');
        assert.equal(status.body.oauthAvailable, false);
        assert.equal(status.body.mode, null);
        const res = await api('post', '/payments/mercadopago/connect', manual.token).expect(409);
        assert.equal(res.body.code, 'OAUTH_UNAVAILABLE');
      });
      assert.equal(await prisma.paymentOauthState.count({ where: { organizationId: manual.organizationId } }), 0);
    });

    it('primeira conexao sem accessToken => 400 ACCESS_TOKEN_REQUIRED; corpo invalido => 400; token recusado => 422 INVALID_CREDENTIALS sem eco nem log', async () => {
      assert.equal((await credentials({ webhookSecret: MANUAL_HOOK_SECRET }).expect(400)).body.code, 'ACCESS_TOKEN_REQUIRED');
      assert.equal((await credentials({}).expect(400)).body.code, 'ACCESS_TOKEN_REQUIRED');
      // Validacao: espaco/quebra interna, curto, null, campo desconhecido.
      await credentials({ accessToken: 'APP_USR-abc def-123' }).expect(400);
      await credentials({ accessToken: 'APP_USR-abc\n-123456' }).expect(400);
      await credentials({ accessToken: 'curto' }).expect(400);
      await credentials({ accessToken: MANUAL_TOKEN, publicKey: null }).expect(400);
      await credentials({ accessToken: MANUAL_TOKEN, clientSecret: 'x' }).expect(400);
      await credentials({ accessToken: 'x'.repeat(600) }).expect(400);

      const bad = `APP_USR-INVALID-${TAG}-123456`;
      const { result, output } = await captureOutput(() => credentials({ accessToken: bad, webhookSecret: MANUAL_HOOK_SECRET }));
      assert.equal(result.status, 422);
      assert.equal(result.body.code, 'INVALID_CREDENTIALS');
      assert.ok(!JSON.stringify(result.body).includes(bad) && !JSON.stringify(result.body).includes(MANUAL_HOOK_SECRET));
      assert.ok(output.includes('Credenciais do Mercado Pago recusadas'), 'a captura do log funciona (o aviso foi logado)');
      assert.ok(!output.includes(bad) && !output.includes(MANUAL_HOOK_SECRET), 'token/segredo fora do log');
      // Provedor fora do ar na validacao => 503 PROVIDER_UNAVAILABLE.
      stub.failNextValidate = 'TRANSIENT';
      assert.equal((await credentials({ accessToken: MANUAL_TOKEN }).expect(503)).body.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(await accountRow(), null, 'nada gravado');
    });

    it('credencial de TESTE em producao => 422 INVALID_CREDENTIALS (sem PAYMENTS_ALLOW_TEST_ACCOUNTS); fora de producao aceita', async () => {
      const res = await atProduction(() => credentials({ accessToken: `TEST-e2e${TAG}-${SELLER_MANUAL}` }));
      assert.equal(res.status, 422);
      assert.equal(res.body.code, 'INVALID_CREDENTIALS');
      assert.equal(await accountRow(), null);
    });

    it('salva (SEM env do MP): CONNECTED, mode MANUAL, tokenHint de 4 chars; token/segredo cifrados v2 e fora de resposta/auditoria/log', async () => {
      const { result, output } = await withEnv(noOauthNoGlobalSecret, () =>
        captureOutput(() => credentials({ accessToken: MANUAL_TOKEN, publicKey: MANUAL_PUBLIC_KEY, webhookSecret: MANUAL_HOOK_SECRET })),
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const body = result.body;
      assert.equal(body.connected, true);
      assert.equal(body.status, 'CONNECTED');
      assert.equal(body.mode, 'MANUAL');
      assert.equal(body.providerUserId, SELLER_MANUAL);
      assert.equal(body.liveMode, true, 'APP_USR- = producao (heuristica do prefixo)');
      assert.equal(body.tokenHint, MANUAL_TOKEN.slice(-4));
      assert.equal(body.tokenHint.length, 4);
      assert.equal(body.publicKey, MANUAL_PUBLIC_KEY);
      assert.equal(body.hasWebhookSecret, true);
      assert.equal(body.oauthAvailable, false);
      assert.equal(body.webhookUrl, `https://painel.e2e.test/api/webhooks/mercadopago?org=${manual.organizationId}`);
      const text = JSON.stringify(body);
      assert.ok(!text.includes(MANUAL_TOKEN) && !text.includes(MANUAL_HOOK_SECRET) && !text.includes('v2:'));
      assert.ok(!output.includes(MANUAL_TOKEN) && !output.includes(MANUAL_HOOK_SECRET), 'token/segredo fora do log');
      assert.ok(!output.includes(DEV_PASSWORD), 'senha da reautenticacao fora do log');
      assert.equal(body.webhookSecretReadable, true);
      assert.equal(body.lastError, null);

      // 2a via (Prisma direto): cifrado, sem refresh/expiracao.
      const row = (await accountRow())!;
      assert.equal(row.mode, 'MANUAL');
      assert.match(row.accessTokenEnc!, /^v2:/);
      assert.match(row.webhookSecretEnc!, /^v2:/);
      assert.ok(!row.accessTokenEnc!.includes(MANUAL_TOKEN) && !row.webhookSecretEnc!.includes(MANUAL_HOOK_SECRET));
      assert.equal(row.refreshTokenEnc, null);
      assert.equal(row.tokenExpiresAt, null);
      assert.equal(row.connectedById, manual.userId);

      const audits = await prisma.auditLog.findMany({ where: { organizationId: manual.organizationId, action: { startsWith: 'PAYMENT_ACCOUNT' } } });
      assert.equal(audits.filter((a) => a.action === 'PAYMENT_ACCOUNT_CONNECT').length, 1);
      const auditText = JSON.stringify(audits);
      assert.ok(auditText.includes('MANUAL') && auditText.includes('signatureKey'));
      assert.ok(!auditText.includes(MANUAL_TOKEN) && !auditText.includes(MANUAL_HOOK_SECRET) && !auditText.includes('v2:'));
      assert.ok(!auditText.includes(DEV_PASSWORD), 'senha fora da auditoria');
      // GET status devolve o mesmo (sem segredo).
      const status = await api('get', '/payments/mercadopago/status', manual.token).expect(200);
      assert.equal(status.body.mode, 'MANUAL');
      assert.ok(!JSON.stringify(status.body).includes(MANUAL_TOKEN));
      // M6: TODOS os Mestres avisados (sino), sem segredo.
      for (const userId of [manual.userId, mestre2.userId]) {
        const notes = await prisma.notification.findMany({ where: { userId, type: 'FINANCE_PAYMENTS_ACCOUNT_CONNECTED' } });
        assert.equal(notes.length, 1, `aviso ao Mestre ${userId}`);
        assert.ok(!notes[0].body.includes(MANUAL_TOKEN));
      }
    });

    it('M6: definir/trocar o token exige a senha (403 REAUTH_REQUIRED / INVALID_PASSWORD) e o 2FA ativo; parcial nao pede senha', async () => {
      const before = (await accountRow())!;
      const missing = await credentials({ accessToken: MANUAL_TOKEN_2, currentPassword: undefined }).expect(403);
      assert.equal(missing.body.code, 'REAUTH_REQUIRED');
      const wrong = await credentials({ accessToken: MANUAL_TOKEN_2, currentPassword: 'senha-errada' }).expect(403);
      assert.equal(wrong.body.code, 'INVALID_PASSWORD');
      assert.ok(!JSON.stringify(wrong.body).includes('senha-errada'));
      assert.equal((await accountRow())!.accessTokenEnc, before.accessTokenEnc, 'nada muda sem reautenticar');
      const failures = await prisma.auditLog.findMany({ where: { organizationId: manual.organizationId, action: 'PAYMENT_ACCOUNT_REAUTH_FAILED' } });
      assert.equal(failures.length, 1);
      assert.ok(!JSON.stringify(failures).includes('senha-errada'));

      // 2FA ativo: senha certa sem codigo => 403 TWO_FACTOR_REQUIRED; codigo errado => 403 INVALID_TWO_FACTOR_CODE; certo => 200.
      const secret = generateTotpSecret();
      await prisma.user.update({
        where: { id: manual.userId },
        data: { twoFactorEnabled: true, twoFactorSecret: encryptTwoFactorSecret(secret), twoFactorLastStep: null },
      });
      try {
        assert.equal((await credentials({ accessToken: MANUAL_TOKEN }).expect(403)).body.code, 'TWO_FACTOR_REQUIRED');
        const right = totpCode(secret);
        const wrongCode = right === '000000' ? '111111' : '000000';
        assert.equal((await credentials({ accessToken: MANUAL_TOKEN, twoFactorCode: wrongCode }).expect(403)).body.code, 'INVALID_TWO_FACTOR_CODE');
        const ok = await credentials({ accessToken: MANUAL_TOKEN, twoFactorCode: right }).expect(200);
        assert.equal(ok.body.status, 'CONNECTED');
      } finally {
        await prisma.user.update({
          where: { id: manual.userId },
          data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastStep: null },
        });
      }
      // Atualizacao parcial (sem token) nao pede senha: coberta pelo teste seguinte (PUT sem currentPassword => 200).
    });

    it('atualizacao PARCIAL (so webhookSecret / publicKey "") nao perde o token; auditada como PAYMENT_ACCOUNT_UPDATE', async () => {
      const before = (await accountRow())!;
      const res = await credentials({ webhookSecret: `${MANUAL_HOOK_SECRET}-2` }).expect(200);
      assert.equal(res.body.connected, true);
      assert.equal(res.body.hasWebhookSecret, true);
      assert.equal(res.body.tokenHint, MANUAL_TOKEN.slice(-4));
      const mid = (await accountRow())!;
      assert.equal(mid.accessTokenEnc, before.accessTokenEnc, 'token intacto');
      assert.notEqual(mid.webhookSecretEnc, before.webhookSecretEnc);
      const cleared = await credentials({ publicKey: '' }).expect(200);
      assert.equal(cleared.body.publicKey, null);
      assert.equal(cleared.body.hasWebhookSecret, true, 'campo ausente nao muda');
      assert.equal((await accountRow())!.accessTokenEnc, before.accessTokenEnc);
      assert.equal(await prisma.auditLog.count({ where: { organizationId: manual.organizationId, action: 'PAYMENT_ACCOUNT_UPDATE' } }), 2);
      // Volta o segredo original para os testes do webhook.
      await credentials({ webhookSecret: MANUAL_HOOK_SECRET, publicKey: MANUAL_PUBLIC_KEY }).expect(200);
    });

    it('outro grupo isolado: nao ve nem altera a conta MANUAL deste grupo', async () => {
      const otherStatus = await api('get', '/payments/mercadopago/status', other.token).expect(200);
      assert.notEqual(otherStatus.body.providerUserId, SELLER_MANUAL);
      assert.notEqual(otherStatus.body.tokenHint, MANUAL_TOKEN.slice(-4));
      assert.equal(otherStatus.body.webhookUrl, `https://painel.e2e.test/api/webhooks/mercadopago?org=${other.organizationId}`);
      assert.equal(await prisma.paymentProviderAccount.count({ where: { providerUserId: SELLER_MANUAL } }), 1);
      // Mestre de outro grupo nao alcanca o lancamento deste.
      const rec = await mkRecord(manual.organizationId, manualStudentId);
      await api('post', `/finance/${rec.id}/pix`, other.token).expect(404);
    });

    it('gera Pix com a conta MANUAL: notification_url do grupo (?org) e SEM application_fee mesmo com taxa configurada', async () => {
      const { result: pix } = await withEnv({ PAYMENTS_APPLICATION_FEE_PERCENT: '5' }, async () => ({ result: await manualPix(15000) }));
      const call = stub.createCalls[stub.createCalls.length - 1];
      assert.equal(call.externalReference, `gingapp:${manual.organizationId}:${pix.recordId}`);
      assert.equal(call.notificationUrl, `https://painel.e2e.test/api/webhooks/mercadopago?org=${manual.organizationId}&source_news=webhooks`);
      assert.equal(call.applicationFeeCents, 0, 'modo MANUAL nao tem split/taxa da plataforma');
      const payment = await stub.getPayment({ accessToken: MANUAL_TOKEN, paymentId: pix.paymentId });
      assert.equal(payment.collectorId, SELLER_MANUAL, 'Pix criado na conta do grupo (token manual)');
    });

    it('A2: assinatura errada/ausente (inclusive com o segredo GLOBAL) => gatilho (sem 401), problema gravado, corpo forjado nao baixa, aviso UNICO; segredo certo => verificado e baixa UMA vez', async () => {
      const { recordId, paymentId } = await manualPix(4400); // PENDENTE no provedor
      await withEnv({ WEBHOOK_UNSIGNED_COOLDOWN_MS: '0' }, async () => {
        // Fabricas (o supertest abre o servidor ao criar o pedido: um por vez).
        const cases: Array<[() => Hook, string]> = [
          // O grupo tem segredo proprio: o global (env) NAO vale para ele (A1) => assinatura nao confere.
          [() => webhook(paymentId, { status: 'approved', transaction_amount: 44 }, { org: manual.organizationId }), 'MISMATCH'],
          [() => webhook(paymentId, {}, { org: manual.organizationId, secret: 'segredo-errado' }), 'MISMATCH'],
          [() => webhook(paymentId, {}, { org: manual.organizationId, signature: null }), 'MISSING'],
        ];
        for (const [make, problem] of cases) {
          const hook = make();
          assert.equal(await hookOutcome(hook), 'PENDING', 'processado como gatilho: o provedor diz pendente');
          const ev = (await eventOf(hook))!;
          assert.equal(ev.signatureVerified, false);
          assert.equal(ev.signatureProblem, problem);
        }
      });
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: recordId } })).status, FinancialStatus.PENDING, 'corpo forjado nao baixa');
      // Aviso UNICO (janela de 24 h) aos Mestres + auditoria, sem o segredo.
      for (const userId of [manual.userId, mestre2.userId]) {
        assert.equal(await prisma.notification.count({ where: { userId, type: 'FINANCE_PAYMENTS_WEBHOOK_SIGNATURE' } }), 1);
      }
      const alerts = await prisma.auditLog.findMany({ where: { organizationId: manual.organizationId, action: 'PAYMENT_WEBHOOK_SIGNATURE_PROBLEM' } });
      assert.equal(alerts.length, 1);
      assert.ok(!JSON.stringify(alerts).includes(MANUAL_HOOK_SECRET));

      stub.setStatus(paymentId, 'APPROVED');
      const ok = webhook(paymentId, {}, { org: manual.organizationId, secret: MANUAL_HOOK_SECRET });
      assert.equal(await hookOutcome(ok), 'PAID');
      assert.equal((await eventOf(ok))!.signatureProblem, null);
      assert.equal(await hookOutcome(webhook(paymentId, {}, { org: manual.organizationId, secret: MANUAL_HOOK_SECRET })), 'DUPLICATE');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recordId } });
      assert.equal(r.status, FinancialStatus.PAID);
      assert.equal(r.paidVia, 'PIX_AUTO');
      assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: String(recordId) } }), 1);
      const events = await prisma.paymentWebhookEvent.findMany({ where: { paymentId, source: 'WEBHOOK', outcome: 'PAID' } });
      assert.equal(events.length, 1);
      assert.equal(events[0].signatureVerified, true);
    });

    it('fallback por user_id (sem ?org): segredo do grupo confere e da a baixa', async () => {
      const { recordId, paymentId } = await manualPix(4500);
      stub.setStatus(paymentId, 'APPROVED');
      assert.equal(await hookOutcome(webhook(paymentId, { user_id: SELLER_MANUAL }, { secret: MANUAL_HOOK_SECRET })), 'PAID');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: recordId } })).status, FinancialStatus.PAID);
      // ?org invalido e ignorado (cai no user_id).
      const { paymentId: p2, recordId: r2 } = await manualPix(4501);
      stub.setStatus(p2, 'APPROVED');
      assert.equal(await hookOutcome(webhook(p2, { user_id: SELLER_MANUAL }, { org: 'abc', secret: MANUAL_HOOK_SECRET })), 'PAID');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: r2 } })).status, FinancialStatus.PAID);
    });

    it('A1: grupo MANUAL SEM segredo proprio + segredo GLOBAL no servidor => gatilho processa (nao 401), signatureVerified=false, sem "problema"', async () => {
      await credentials({ webhookSecret: '' }).expect(200);
      assert.ok(process.env.MERCADOPAGO_WEBHOOK_SECRET, 'o segredo global (compat) esta definido neste teste');
      const real = await manualPix(4550);
      stub.setStatus(real.paymentId, 'APPROVED');
      // Assinado com o segredo GLOBAL (o de uma aplicacao que NAO e a do grupo): nao vale para MANUAL, mas nao derruba.
      const hook = webhook(real.paymentId, {}, { org: manual.organizationId });
      assert.equal(await hookOutcome(hook), 'PAID');
      const ev = (await eventOf(hook))!;
      assert.equal(ev.signatureVerified, false);
      assert.equal(ev.signatureProblem, null, 'sem segredo do grupo = gatilho simples, nao "assinatura errada"');
    });

    it('SEM segredo nenhum: processa como GATILHO (signatureVerified=false); corpo forjado nao baixa; gatilho que nao resolve NAO grava (M5)', async () => {
      await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: undefined }, async () => {
        const pending = await manualPix(4600);
        // Corpo forjado dizendo "aprovado" (sem assinatura): o provedor diz pendente => nada de baixa.
        const forged = webhook(
          pending.paymentId,
          { action: 'payment.updated', status: 'approved', transaction_amount: 46, live_mode: true },
          { org: manual.organizationId, signature: null },
        );
        assert.equal(await hookOutcome(forged), 'PENDING');
        assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: pending.recordId } })).status, FinancialStatus.PENDING);
        assert.equal((await eventOf(forged))!.signatureVerified, false);
        // Mesmo pagamento de novo em menos de 5 s, sem assinatura: 429 (cache anti-martelada).
        assert.equal((await webhook(pending.paymentId, {}, { org: manual.organizationId, signature: null })).status, 429);

        // Pagamento inexistente / de outro vendedor / referencia forjada: nada baixa e NADA e gravado (M5-a).
        const before = await prisma.paymentWebhookEvent.count();
        assert.equal(await hookOutcome(webhook('999999999999', { user_id: SELLER_MANUAL }, { org: manual.organizationId, signature: null })), null);
        const forgedRef = stub.seedPayment({ sellerUserId: SELLER_OTHER, amountCents: 4600, externalReference: `gingapp:${manual.organizationId}:${pending.recordId}` });
        assert.equal(await hookOutcome(webhook(forgedRef, { user_id: SELLER_MANUAL }, { org: manual.organizationId, signature: null })), null);
        // Assinatura presente mas sem segredo algum para conferir: so gatilho (nunca confianca no corpo).
        const forgedRef2 = stub.seedPayment({ sellerUserId: SELLER_OTHER, amountCents: 4600, externalReference: `gingapp:${manual.organizationId}:${pending.recordId}` });
        assert.equal(await hookOutcome(webhook(forgedRef2, {}, { org: manual.organizationId, secret: 'qualquer' })), null);
        assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: pending.recordId } })).status, FinancialStatus.PENDING);
        // Sem nenhuma pista de grupo e sem segredo: descartado sem gravar nada.
        assert.equal(await hookOutcome(webhook('888888888888', {}, { signature: null })), null);
        // B2: grupo inexistente responde IGUAL (sem oraculo de enumeracao).
        assert.equal(await hookOutcome(webhook('888888888889', {}, { org: 2_000_000_000, signature: null })), null);
        assert.equal(await prisma.paymentWebhookEvent.count(), before, 'nenhuma linha gravada pelos gatilhos que nao resolveram');

        // O gatilho funciona para o pagamento REAL aprovado no provedor (a baixa vem do provedor, nao do corpo).
        const real = await manualPix(4700);
        stub.setStatus(real.paymentId, 'APPROVED');
        assert.equal(await hookOutcome(webhook(real.paymentId, {}, { org: manual.organizationId, signature: null })), 'PAID');
        assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: real.recordId } })).status, FinancialStatus.PAID);
        assert.equal(await prisma.auditLog.count({ where: { action: 'FINANCE_PAY', resourceId: String(real.recordId) } }), 1);

        // Limite POR GRUPO dos gatilhos de id DESCONHECIDO (apertado); pagamento JA CONHECIDO do grupo usa o limite generoso (M5-b).
        const known = await manualPix(4710);
        await withEnv({ WEBHOOK_UNSIGNED_ORG_LIMIT: '1' }, async () => {
          const limited = await webhook('777777777777', {}, { org: manual.organizationId, signature: null });
          assert.equal(limited.status, 429);
          assert.equal(limited.body.code, 'WEBHOOK_RATE_LIMITED');
          assert.equal(await hookOutcome(webhook(known.paymentId, {}, { org: manual.organizationId, signature: null })), 'PENDING');
        });
      });
      await credentials({ webhookSecret: MANUAL_HOOK_SECRET }).expect(200);
    });

    it('troca para OUTRA conta com Pix aberto => 409 PIX_OPEN_ACCOUNT_CHANGE (nada muda); sem Pix aberto troca, audita e avisa os Mestres', async () => {
      const open = await prisma.financialRecord.findMany({
        where: { organizationId: manual.organizationId, gatewayStatus: 'pending', status: { in: ['PENDING', 'OVERDUE'] }, pixExpiresAt: { gt: new Date() } },
      });
      assert.ok(open.length >= 1, 'ha Pix aberto da conta atual');
      const before = (await accountRow())!;
      const blocked = await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(409);
      assert.equal(blocked.body.code, 'PIX_OPEN_ACCOUNT_CHANGE');
      const same = (await accountRow())!;
      assert.equal(same.providerUserId, SELLER_MANUAL);
      assert.equal(same.accessTokenEnc, before.accessTokenEnc);
      // Colar de novo o token da MESMA conta nao e troca (permitido mesmo com Pix aberto).
      await credentials({ accessToken: MANUAL_TOKEN }).expect(200);

      for (const r of open) await api('post', `/finance/${r.id}/cancel`, manual.token).expect(200);
      const changed = await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200);
      assert.equal(changed.body.providerUserId, SELLER_MANUAL_2);
      assert.equal(changed.body.hasWebhookSecret, false, 'assinatura da conta antiga nao vale para a nova');
      assert.equal(await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED' } }), 1);
      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: manual.organizationId, action: 'PAYMENT_ACCOUNT_CONNECT' },
        orderBy: { id: 'desc' },
      });
      assert.ok(JSON.stringify(audit).includes('previousProviderUserId'));
      assert.ok(!JSON.stringify(audit).includes(MANUAL_TOKEN_2));
    });

    const DAY = 24 * 60 * 60 * 1000;
    const accountWhere = () => ({ organizationId_provider: { organizationId: manual.organizationId, provider: 'stub' } });

    it('M3-a: troca de conta bloqueada tambem por Pix VENCIDO sem confirmacao (pendente ou expired_unconfirmed) ate 7 dias', async () => {
      const rec = await mkRecord(manual.organizationId, manualStudentId, 4720);
      await api('post', `/finance/${rec.id}/pix`, manual.token).expect(200);
      const accounts = app.get(PaymentAccountService);
      // Vencido ha 2 dias no relogio, o provedor nunca confirmou: ainda pode ter sido pago no ultimo minuto.
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixExpiresAt: new Date(Date.now() - 2 * DAY) } });
      assert.equal((await credentials({ accessToken: MANUAL_TOKEN }).expect(409)).body.code, 'PIX_OPEN_ACCOUNT_CHANGE');
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { gatewayStatus: 'expired_unconfirmed' } });
      assert.equal((await credentials({ accessToken: MANUAL_TOKEN }).expect(409)).body.code, 'PIX_OPEN_ACCOUNT_CHANGE');
      assert.equal((await accountRow())!.providerUserId, SELLER_MANUAL_2, 'nada mudou');
      // Mais de 7 dias depois da validade deixa de bloquear.
      const n = await accounts.countUnresolvedPix(manual.organizationId);
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixExpiresAt: new Date(Date.now() - 8 * DAY) } });
      assert.equal(await accounts.countUnresolvedPix(manual.organizationId), n - 1);
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { status: FinancialStatus.CANCELLED } });
    });

    it('M3-c: Pix de OUTRA conta (gatewayAccountId) vira account_changed na reconciliacao e no GET (terminal + alerta unico); novo Pix na conta atual', async () => {
      const rec = await mkRecord(manual.organizationId, manualStudentId, 4730);
      await api('post', `/finance/${rec.id}/pix`, manual.token).expect(200);
      let row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(row.gatewayAccountId, SELLER_MANUAL_2, 'grava a conta em que o Pix foi criado');
      const firstPid = row.gatewayPaymentId;
      // Simula um Pix criado na conta ANTERIOR do grupo.
      await prisma.financialRecord.update({
        where: { id: rec.id },
        data: { gatewayAccountId: SELLER_MANUAL, pixGeneratedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });
      const createsBefore = stub.createCalls.length;
      const stats = await app.get(PixService).reconcilePending();
      assert.ok(stats.accountChanged >= 1, JSON.stringify(stats));
      row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(row.gatewayStatus, 'account_changed');
      assert.equal(row.status, FinancialStatus.PENDING, 'nada de baixa as cegas');
      const alertWhere = { action: 'PAYMENT_PIX_ALERT', resourceId: String(rec.id) };
      assert.equal(await prisma.auditLog.count({ where: alertWhere }), 1);
      assert.ok(JSON.stringify(await prisma.auditLog.findFirst({ where: alertWhere })).includes('ACCOUNT_CHANGED'));
      const noteWhere = { userId: manual.userId, type: 'FINANCE_PIX_ALERT', body: { contains: 'conta ANTERIOR' } };
      assert.equal(await prisma.notification.count({ where: noteWhere }), 1);
      // Terminal: nao volta para a fila (nem alerta de novo).
      await app.get(PixService).reconcilePending(new Date(Date.now() + 6 * 60 * 1000));
      assert.equal(await prisma.auditLog.count({ where: alertWhere }), 1);
      // Gerar de novo cria um Pix na conta ATUAL.
      const again = await api('post', `/finance/${rec.id}/pix`, manual.token).expect(200);
      assert.equal(again.body.status, 'PENDING');
      assert.equal(stub.createCalls.length, createsBefore + 1);
      row = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.notEqual(row.gatewayPaymentId, firstPid);
      assert.equal(row.gatewayAccountId, SELLER_MANUAL_2);
      // GET /pix de um Pix de outra conta: terminal tambem (sem 404 eterno), segundo alerta (outro pagamento).
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { gatewayAccountId: SELLER_MANUAL } });
      const view = await api('get', `/finance/${rec.id}/pix`, manual.token).expect(200);
      assert.equal(view.body.status, 'CANCELLED');
      assert.equal(view.body.qrCode, null);
      assert.equal(await prisma.auditLog.count({ where: alertWhere }), 2);
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { status: FinancialStatus.CANCELLED } });
    });

    it('M3-b: troca de conta x gravacao de Pix serializadas pelo lock da conta; conta trocada DURANTE a chamada ao provedor => Pix cancelado, nada gravado', async () => {
      const accounts = app.get(PaymentAccountService);
      const order: string[] = [];
      const exclusive = accounts.withAccountLock(manual.organizationId, 'exclusive', async () => {
        order.push('troca:inicio');
        await sleep(300);
        order.push('troca:fim');
      });
      while (!order.includes('troca:inicio')) await sleep(10);
      const shared = accounts.withAccountLock(manual.organizationId, 'shared', async () => {
        order.push('pix');
      });
      await Promise.all([exclusive, shared]);
      assert.deepEqual(order, ['troca:inicio', 'troca:fim', 'pix'], 'a gravacao do Pix espera a troca terminar');

      const rec = await mkRecord(manual.organizationId, manualStudentId, 4740);
      const seen: { id?: string } = {};
      stub.onPixCreated = async (payment) => {
        seen.id = payment.id;
        // Outra replica troca a conta enquanto o provedor respondia.
        await prisma.paymentProviderAccount.update({ where: accountWhere(), data: { providerUserId: `troca-${TAG}` } });
      };
      try {
        const res = await api('post', `/finance/${rec.id}/pix`, manual.token).expect(409);
        assert.equal(res.body.code, 'ACCOUNT_CHANGED');
      } finally {
        stub.onPixCreated = null;
        await prisma.paymentProviderAccount.update({ where: accountWhere(), data: { providerUserId: SELLER_MANUAL_2 } });
      }
      assert.ok(seen.id, 'o Pix chegou a ser criado no provedor');
      assert.equal((await stub.getPayment({ accessToken: MANUAL_TOKEN_2, paymentId: seen.id })).status, 'CANCELLED');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).gatewayPaymentId, null);
    });

    it('A2: segredo do webhook ILEGIVEL => status webhookSecretReadable=false; webhook vira gatilho UNREADABLE com aviso; colar o token limpa o segredo', async () => {
      const newSecret = `${MANUAL_HOOK_SECRET}-novo`;
      await credentials({ webhookSecret: newSecret }).expect(200);
      const acc = await prisma.paymentProviderAccount.findUniqueOrThrow({ where: accountWhere() });
      const parts = acc.webhookSecretEnc!.split(':');
      parts[3] = Buffer.from('lixo').toString('base64');
      await prisma.paymentProviderAccount.update({ where: accountWhere(), data: { webhookSecretEnc: parts.join(':') } });
      const st = await api('get', '/payments/mercadopago/status', manual.token).expect(200);
      assert.equal(st.body.hasWebhookSecret, true);
      assert.equal(st.body.webhookSecretReadable, false);

      const p = await manualPix(4810);
      stub.setStatus(p.paymentId, 'APPROVED');
      const notesBefore = await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_WEBHOOK_SIGNATURE' } });
      const hook = webhook(p.paymentId, {}, { org: manual.organizationId, secret: newSecret });
      assert.equal(await hookOutcome(hook), 'PAID', 'o Pix e confirmado pela consulta ao provedor');
      const ev = (await eventOf(hook))!;
      assert.equal(ev.signatureVerified, false);
      assert.equal(ev.signatureProblem, 'UNREADABLE');
      assert.equal(await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_WEBHOOK_SIGNATURE' } }), notesBefore + 1);

      const re = await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200);
      assert.equal(re.body.hasWebhookSecret, false, 'segredo ilegivel limpo ao colar o token');
      assert.equal(re.body.webhookSecretReadable, true);
    });

    it('B3/B4: 403 do provedor (politica) no uso e em /users/me NAO poe a conta em ERROR (503, conta segue CONNECTED)', async () => {
      const errorsBefore = await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } });
      stub.forbiddenTokens.add(MANUAL_TOKEN_2);
      try {
        const rec = await mkRecord(manual.organizationId, manualStudentId, 4820);
        const res = await api('post', `/finance/${rec.id}/pix`, manual.token).expect(503);
        assert.equal(res.body.code, 'PROVIDER_UNAVAILABLE');
        assert.equal((await accountRow())!.status, 'CONNECTED');
      } finally {
        stub.forbiddenTokens.delete(MANUAL_TOKEN_2);
      }
      assert.equal(await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } }), errorsBefore);
    });

    it('renovacao/cron PULAM a conta MANUAL (sem refresh); reconciliacao funciona igual', async () => {
      const refreshBefore = stub.refreshCalls;
      const where = { organizationId_provider: { organizationId: manual.organizationId, provider: 'stub' } };
      // Mesmo com uma validade "perto de vencer" gravada, a conta MANUAL nao entra na renovacao.
      await prisma.paymentProviderAccount.update({ where, data: { tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      const before = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      const rec = await mkRecord(manual.organizationId, manualStudentId, 4800);
      await api('post', `/finance/${rec.id}/pix`, manual.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'APPROVED');
      await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixGeneratedAt: new Date(Date.now() - 20 * 60 * 1000) } });
      await app.get(PaymentAccountService).refreshExpiring();
      const stats = await app.get(PixService).reconcilePending();
      assert.ok(stats.paid >= 1);
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).status, FinancialStatus.PAID);
      assert.equal(stub.refreshCalls, refreshBefore, 'nenhum refresh para conta MANUAL');
      const after = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      assert.equal(after.accessTokenEnc, before.accessTokenEnc);
      assert.equal(after.status, 'CONNECTED');
      await prisma.paymentProviderAccount.update({ where, data: { tokenExpiresAt: null } });
    });

    it('token MANUAL revogado no provedor em uso => conta ERROR + aviso "cole as credenciais" + MP_ACCOUNT_ERROR; colar de novo reconecta', async () => {
      const pending = await manualPix(4890);
      stub.revokedTokens.add(MANUAL_TOKEN_2);
      try {
        // B1: revogacao descoberta NO MEIO do webhook => 503 (o MP reenvia), nao "processado/UNRESOLVED".
        const hook = webhook(pending.paymentId, {}, { org: manual.organizationId, signature: null });
        const res = await hook;
        assert.equal(res.status, 503);
        assert.equal(res.body.code, 'PAYMENTS_ACCOUNT_UNAVAILABLE');
        assert.equal(await eventOf(hook), null, 'gatilho nao assinado nao grava linha');
        assert.equal((await accountRow())!.status, 'ERROR');
        const rec = await mkRecord(manual.organizationId, manualStudentId, 4900);
        assert.equal((await api('post', `/finance/${rec.id}/pix`, manual.token).expect(409)).body.code, 'MP_ACCOUNT_ERROR');
        const row = (await accountRow())!;
        assert.equal(row.status, 'ERROR');
        assert.match(row.lastError ?? '', /Cole as credenciais/);
        const notes = await prisma.notification.findMany({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } });
        assert.equal(notes.length, 1);
        assert.match(notes[0].body, /Access Token/);
        const status = await api('get', '/payments/mercadopago/status', manual.token).expect(200);
        assert.equal(status.body.status, 'ERROR');
        assert.equal(status.body.connected, false);
        assert.equal(status.body.mode, 'MANUAL');
        assert.match(status.body.lastError ?? '', /Cole as credenciais/, 'B8: o motivo curto vai no status');
        // Colar o token novamente (agora valido) volta a CONNECTED.
        stub.revokedTokens.delete(MANUAL_TOKEN_2);
        assert.equal((await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200)).body.status, 'CONNECTED');
      } finally {
        stub.revokedTokens.delete(MANUAL_TOKEN_2);
      }
    });

    it('chave trocada (token ilegivel) => ERROR com mensagem clara, sem crash', async () => {
      const where = { organizationId_provider: { organizationId: manual.organizationId, provider: 'stub' } };
      const acc = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      const parts = acc.accessTokenEnc!.split(':');
      parts[3] = Buffer.from('lixo').toString('base64');
      await prisma.paymentProviderAccount.update({ where, data: { accessTokenEnc: parts.join(':') } });
      const rec = await mkRecord(manual.organizationId, manualStudentId, 5000);
      assert.equal((await api('post', `/finance/${rec.id}/pix`, manual.token).expect(409)).body.code, 'MP_ACCOUNT_ERROR');
      const row = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      assert.equal(row.status, 'ERROR');
      assert.match(row.lastError ?? '', /ilegível/);
      await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200);
    });

    it('M2: PAYMENTS_TOKEN_KEY definida DEPOIS nao quebra (decifra pela chave antiga e re-cifra uma vez); JWT trocado sem chave => ERROR com UM aviso, sem loop', async () => {
      const jwtTrocado = `e2e-jwt-trocado-${TAG}-`.padEnd(64, 'j');
      await withEnv({ PAYMENTS_TOKEN_KEY: undefined }, () => credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200));
      const before = (await accountRow())!.accessTokenEnc;
      await withEnv({ PAYMENTS_TOKEN_KEY: TOKEN_KEY_LATER }, async () => {
        const a = await mkRecord(manual.organizationId, manualStudentId, 5100);
        await api('post', `/finance/${a.id}/pix`, manual.token).expect(200);
      });
      const rotated = (await accountRow())!.accessTokenEnc;
      assert.notEqual(rotated, before, 're-cifrado com a chave nova (rotacao preguicosa)');
      // Agora so a chave nova importa: trocar o JWT_SECRET nao atrapalha; e nao re-cifra de novo.
      await withEnv({ PAYMENTS_TOKEN_KEY: TOKEN_KEY_LATER, JWT_SECRET: jwtTrocado }, async () => {
        const b = await mkRecord(manual.organizationId, manualStudentId, 5200);
        await api('post', `/finance/${b.id}/pix`, manual.token).expect(200);
      });
      assert.equal((await accountRow())!.accessTokenEnc, rotated, 'rotacao acontece UMA vez');
      // Sem a chave e com o JWT trocado: nenhuma chave decifra => ERROR + UM aviso; as chamadas seguintes nao repetem.
      const notesBefore = await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } });
      await withEnv({ PAYMENTS_TOKEN_KEY: undefined, JWT_SECRET: jwtTrocado }, async () => {
        for (const amount of [5300, 5301, 5302]) {
          const r = await mkRecord(manual.organizationId, manualStudentId, amount);
          assert.equal((await api('post', `/finance/${r.id}/pix`, manual.token).expect(409)).body.code, 'MP_ACCOUNT_ERROR');
        }
      });
      const row = (await accountRow())!;
      assert.equal(row.status, 'ERROR');
      assert.match(row.lastError ?? '', /ilegível/);
      assert.equal(await prisma.notification.count({ where: { userId: manual.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } }), notesBefore + 1);
      // Reconecta (ambiente padrao) para o teste seguinte.
      await credentials({ accessToken: MANUAL_TOKEN_2 }).expect(200);
    });

    it('desconectar apaga token, segredo e final do token (REVOKED); depois exige accessToken de novo', async () => {
      const res = await api('delete', '/payments/mercadopago/disconnect', manual.token).expect(200);
      assert.equal(res.body.status, 'REVOKED');
      assert.equal(res.body.connected, false);
      assert.equal(res.body.mode, null);
      assert.equal(res.body.tokenHint, null);
      assert.equal(res.body.hasWebhookSecret, false);
      const row = (await accountRow())!;
      assert.equal(row.accessTokenEnc, null);
      assert.equal(row.webhookSecretEnc, null);
      assert.equal(row.tokenHint, null);
      assert.equal((await credentials({ webhookSecret: 'x-y-z' }).expect(400)).body.code, 'ACCESS_TOKEN_REQUIRED');
      assert.ok(await prisma.auditLog.count({ where: { organizationId: manual.organizationId, action: 'PAYMENT_ACCOUNT_DISCONNECT' } }) >= 1);
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

    it('A2 (OAUTH, segredo do SERVIDOR): assinatura ausente/errada/antiga/malformada => gatilho (200, nunca 401), corpo forjado nao baixa; so auditoria (1x), sem aviso ao Mestre', async () => {
      await withEnv({ WEBHOOK_UNSIGNED_COOLDOWN_MS: '0' }, async () => {
        const cases: Array<[() => Hook, string]> = [
          [() => webhook(paymentId, { id: `n-${TAG}-a`, user_id: SELLER_MAIN, status: 'approved' }, { signature: null }), 'MISSING'],
          [() => webhook(paymentId, { id: `n-${TAG}-b`, user_id: SELLER_MAIN }, { secret: 'segredo-errado' }), 'MISMATCH'],
          [() => webhook(paymentId, { id: `n-${TAG}-c`, user_id: SELLER_MAIN }, { ts: Date.now() - 60 * 60 * 1000 }), 'MISMATCH'],
          [() => webhook(paymentId, { id: `n-${TAG}-d`, user_id: SELLER_MAIN }, { signature: 'ts=1,v1=zz' }), 'MISMATCH'],
        ];
        for (const [make, problem] of cases) {
          const hook = make();
          assert.equal(await hookOutcome(hook), 'PENDING', 'o provedor diz pendente');
          const ev = (await eventOf(hook))!;
          assert.equal(ev.signatureVerified, false);
          assert.equal(ev.signatureProblem, problem);
        }
      });
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(await prisma.auditLog.count({ where: { organizationId: main.organizationId, action: 'PAYMENT_WEBHOOK_SIGNATURE_PROBLEM' } }), 1);
      assert.equal(await prisma.notification.count({ where: { userId: main.userId, type: 'FINANCE_PAYMENTS_WEBHOOK_SIGNATURE' } }), 0);
    });

    it('approved valido da baixa UMA vez (PIX, PIX_AUTO, recibo, avisos); reentrega e outra notificacao nao duplicam', async () => {
      stub.setStatus(paymentId, 'APPROVED');
      assert.equal(await hookOutcome(webhook(paymentId, { id: `n-${TAG}-1`, user_id: SELLER_MAIN })), 'PAID');

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
      assert.equal(await hookOutcome(webhook(paymentId, { id: `n-${TAG}-1`, user_id: SELLER_MAIN })), 'DUPLICATE');
      assert.equal(await hookOutcome(webhook(paymentId, { id: `n-${TAG}-2`, user_id: SELLER_MAIN })), 'DUPLICATE');

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
      assert.equal(await hookOutcome(webhook(pid, { user_id: SELLER_MAIN })), 'ORPHAN_PAID');
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
      assert.equal(await hookOutcome(webhook(paymentId, { id: `n-${TAG}-3`, user_id: SELLER_MAIN })), 'ALREADY_APPLIED');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recPaid } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(r.paidVia, null);
    });

    it('valor divergente nao da baixa e alerta o Mestre (uma vez)', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 20000);
      const forged = stub.seedPayment({ sellerUserId: SELLER_MAIN, amountCents: 100, externalReference: `gingapp:${main.organizationId}:${rec.id}` });
      assert.equal(await hookOutcome(webhook(forged, { id: `n-${TAG}-4`, user_id: SELLER_MAIN })), 'AMOUNT_MISMATCH');
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
      // Assinado (segredo do servidor, contas OAUTH): fica a trilha UNRESOLVED.
      assert.equal(await hookOutcome(webhook(foreign, { id: `n-${TAG}-6`, user_id: SELLER_OTHER })), 'UNRESOLVED');
      // user_id "mentindo" (vendedor do grupo principal): o token dele nao enxerga o pagamento do outro vendedor.
      assert.equal(await hookOutcome(webhook(foreign, { id: `n-${TAG}-7`, user_id: SELLER_MAIN })), 'UNRESOLVED');
      const r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PENDING);
    });

    it('cancelado/recusado libera um NOVO Pix', async () => {
      const rec = await mkRecord(main.organizationId, alunoStudentId, 7000);
      const first = await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
      const pid = await paymentIdOf(rec.id);
      stub.setStatus(pid, 'CANCELLED');
      assert.equal(await hookOutcome(webhook(pid, { id: `n-${TAG}-8`, user_id: SELLER_MAIN })), 'CANCELLED');
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
      assert.equal(await hookOutcome(webhook(oldPid, { id: `n-${TAG}-9`, user_id: SELLER_MAIN })), 'AMOUNT_MISMATCH');
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

    it('M4: lote POR GRUPO (perOrg) - um grupo nao monopoliza a rodada; o resto fica para a proxima', async () => {
      const recs: number[] = [];
      for (const [amount, minutesAgo] of [[6010, 30], [6020, 20]] as const) {
        const rec = await mkRecord(main.organizationId, alunoStudentId, amount);
        await api('post', `/finance/${rec.id}/pix`, main.token).expect(200);
        stub.setStatus(await paymentIdOf(rec.id), 'APPROVED');
        await prisma.financialRecord.update({ where: { id: rec.id }, data: { pixGeneratedAt: new Date(Date.now() - minutesAgo * 60 * 1000) } });
        recs.push(rec.id);
      }
      const statusOf = async () => Promise.all(recs.map(async (id) => (await prisma.financialRecord.findUniqueOrThrow({ where: { id } })).status));
      await app.get(PixService).reconcilePending(new Date(), 300, 1);
      assert.deepEqual(await statusOf(), [FinancialStatus.PAID, FinancialStatus.PENDING], 'so 1 por grupo nesta rodada (o mais antigo)');
      await app.get(PixService).reconcilePending(new Date(), 300, 1);
      assert.deepEqual(await statusOf(), [FinancialStatus.PAID, FinancialStatus.PAID]);
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

      // M4: na MESMA rodada, um Pix aprovado de OUTRO grupo (conta ok) e conferido normalmente.
      const otherStudent = await mkStudent(other.organizationId, 'Aluno M4', { email: `aluno-m4-${TAG}@${MAIL_DOMAIN}` });
      const otherRec = await mkRecord(other.organizationId, otherStudent.id, 6110);
      await api('post', `/finance/${otherRec.id}/pix`, other.token).expect(200);
      stub.setStatus(await paymentIdOf(otherRec.id), 'APPROVED');
      await prisma.financialRecord.update({ where: { id: otherRec.id }, data: { pixGeneratedAt: new Date(Date.now() - 20 * 60 * 1000) } });

      const stats = await app.get(PixService).reconcilePending();
      assert.ok(stats.unavailable >= 1);
      let r = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
      assert.equal(r.status, FinancialStatus.PENDING);
      assert.equal(r.gatewayStatus, 'pending', 'nunca vence localmente sem resposta do provedor');
      assert.equal(r.pixLastCheckedAt, null, 'M4: grupo sem conta utilizavel e PULADO sem reivindicar (nao consome o lote)');
      assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: otherRec.id } })).status, FinancialStatus.PAID);

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
      assert.equal((await connectRaw(other, SELLER_NEW)).mp, 'pix-aberto');
      const acc = await prisma.paymentProviderAccount.findFirstOrThrow({ where: { organizationId: other.organizationId } });
      assert.equal(acc.providerUserId, SELLER_OTHER);

      for (const r of open) await api('post', `/finance/${r.id}/cancel`, other.token).expect(200);
      assert.equal((await connectRaw(other, SELLER_NEW)).mp, 'ok');
      assert.equal(await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_CHANGED' } }), 1);
      const audit = await prisma.auditLog.findFirst({
        where: { organizationId: other.organizationId, action: 'PAYMENT_ACCOUNT_CONNECT' },
        orderBy: { id: 'desc' },
      });
      assert.ok(JSON.stringify(audit).includes('previousProviderUserId'));
    });

    it('B7: conta OAUTH vencida SEM o OAuth no servidor => ERROR "reconecte colando as credenciais" + UM aviso (nao 503 eterno)', async () => {
      const where = { organizationId_provider: { organizationId: other.organizationId, provider: 'stub' } };
      const before = await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } });
      const student = await mkStudent(other.organizationId, 'Aluno B7', { email: `aluno-b7-${TAG}@${MAIL_DOMAIN}` });
      await withEnv({ MERCADOPAGO_CLIENT_ID: undefined, MERCADOPAGO_CLIENT_SECRET: undefined, MERCADOPAGO_REDIRECT_URI: undefined }, async () => {
        await prisma.paymentProviderAccount.update({ where, data: { tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000) } });
        for (const amount of [6300, 6301]) {
          const rec = await mkRecord(other.organizationId, student.id, amount);
          assert.equal((await api('post', `/finance/${rec.id}/pix`, other.token).expect(409)).body.code, 'MP_ACCOUNT_ERROR');
        }
      });
      const row = await prisma.paymentProviderAccount.findUniqueOrThrow({ where });
      assert.equal(row.status, 'ERROR');
      assert.match(row.lastError ?? '', /colando as credenciais/);
      assert.equal(await prisma.notification.count({ where: { userId: other.userId, type: 'FINANCE_PAYMENTS_ACCOUNT_ERROR' } }), before + 1);
      await connect(other, SELLER_NEW); // reconecta (OAuth de volta no ambiente)
      assert.equal((await prisma.paymentProviderAccount.findUniqueOrThrow({ where })).status, 'CONNECTED');
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
