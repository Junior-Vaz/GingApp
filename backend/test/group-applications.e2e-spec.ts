import { INestApplication } from '@nestjs/common';
import { GroupApplicationStatus, OrganizationType, OrgRole, Prisma, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { GroupApplicationsService } from '../src/interface/http/group-applications/group-applications.service';
import { TEAM_NOTIFY_SETTING_KEY } from '../src/interface/http/group-applications/group-application-rules';
import { GroupApplicationsRetentionCronService } from '../src/jobs/group-applications-retention-cron.service';
import { LEGAL_VERSION } from '../src/shared/legal/legal-documents';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { createPlatformUser, platformLogin, TEAM_DOMAIN, TEAM_PASSWORD } from './utils/platform-team-fixtures';
import { createTestApp, MemoryMailTransport } from './utils/test-app';

/**
 * Adesao de grupos (docs/CONTRATO_ADESAO_GRUPOS.md secao 9, backend): pedido valido; 400 de campo; honeypot; e-mail com
 * conta/pedido pendente/teto de 3 em 30 dias = MESMA resposta 201 sem gravar nada; SENHA-SENTINELA varrida em TODAS as
 * respostas, no stdout/stderr (log de requisicao ligado), na auditoria e no banco; so o hash do token guardado; status por
 * token (3 estados + 404 uniforme); aprovar cria grupo+MESTRE+Matriz+cargos e o LOGIN REAL funciona com a senha do pedido;
 * 2 aprovacoes simultaneas = 1 vence; EMAIL_TAKEN; slug em uso; rejeitar com motivo (aparece no status publico); falha de
 * e-mail nao desfaz a decisao; travas por papel (sem token 401, MEMBER 403, PLATFORM comum le mas nao decide); CHECKs do
 * banco; retencao (off/dry-run/true); throttle por IP (limites rebaixados por env).
 *
 * Confirmacao do e-mail + aviso a equipe + Instagram (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md secoes 1, 2, 6 e 7): o spec sobe
 * DOIS apps no mesmo banco: `app` com o e-mail LIGADO (transporte em memoria: pedido nasce UNVERIFIED, link de confirmacao
 * por e-mail) e `appOff` com o e-mail DESLIGADO (sem transporte e SMTP_HOST vazio: nasce PENDING + SKIPPED). O helper
 * `submit()` faz o fluxo REAL completo no modo ligado (POST, espera o e-mail em segundo plano, tira o token do link e
 * confirma por POST), devolvendo um pedido PENDING/VERIFIED para os testes de decisao.
 *
 * Tudo que o spec cria usa o dominio @e2e-adesao.local / nome "E2E Adesao <stamp>" e e apagado no after().
 * Com ADESAO_CAPTURE_DIR definido grava o JSON REAL: adesao2-real-public.json (POST 201 nos dois modos, GET em
 * UNVERIFIED/PENDING verificado/PENDING SKIPPED/APPROVED/REJECTED, confirm 200/404, resend 204/429) e
 * adesao2-real-admin.json (lista do admin com UNVERIFIED, PENDING verificado, PENDING SKIPPED, com e sem instagram, e os
 * demais status) para virar fixture do painel/admin.
 */
const DOMAIN = 'e2e-adesao.local';
const TEAM_TAG = 'adesao';
const VERIFY_SUBJECT = 'Confirme seu e-mail - GingApp';
const TEAM_SUBJECT = 'Novo pedido de adesão aguardando análise - GingApp';
const LINK_TOKEN = /comecar\/confirmar\/([A-Za-z0-9_-]{43})/;

describe('Adesão de grupos (e2e)', () => {
  let app: INestApplication;
  let appOff: INestApplication;
  let service: GroupApplicationsService;
  let serviceOff: GroupApplicationsService;
  const prisma = new PrismaClient();
  const mail = new MemoryMailTransport();
  /** Valor original da linha de agrupamento do aviso a equipe (restaurado no after: o banco e compartilhado). */
  let originalNotifySetting: { value: Prisma.JsonValue } | null = null;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const NAME = `E2E Adesao ${stamp}`;
  /** Senha-sentinela: NUNCA pode aparecer em resposta, log, auditoria, e-mail ou coluna do banco. */
  const SENTINEL = `SENHA-SENTINELA-${stamp}!`;
  const envBackup = { ...process.env };

  // Toda resposta HTTP do spec passa por aqui (corpo bruto guardado para a varredura da sentinela).
  const seenBodies: string[] = [];
  const rec = async (req: request.Test) => {
    const res = await req;
    seenBodies.push(res.text ?? '');
    return res;
  };
  const http = () => request(app.getHttpServer());
  const httpOff = () => request(appOff.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const pubPost = (body: object) => rec(http().post('/api/public/group-applications').send(body));
  const pubPostOff = (body: object) => rec(httpOff().post('/api/public/group-applications').send(body));
  const pubGet = (token: string) => rec(http().get(`/api/public/group-applications/${token}`));
  const pubConfirm = (body: object) => rec(http().post('/api/public/group-applications/confirm').send(body));
  const pubResend = (token: string) => rec(http().post(`/api/public/group-applications/${token}/resend`));
  /** Espera os e-mails disparados em segundo plano pelos dois apps. */
  const settle = async () => {
    await service.settleBackground();
    await serviceOff.settleBackground();
  };
  /** Todos os tokens de LINK de confirmacao vistos nos e-mails (varridos nos logs no fim). */
  const linkTokens = new Set<string>();
  const verifyMails = (to: string) => mail.to(to).filter((m) => m.subject === VERIFY_SUBJECT);
  /** Token do ULTIMO e-mail de confirmacao enviado para `to`. */
  const lastLinkToken = (to: string): string => {
    const all = verifyMails(to);
    assert.ok(all.length > 0, `nenhum e-mail de confirmação para ${to}`);
    const match = LINK_TOKEN.exec(all[all.length - 1].text);
    assert.ok(match, 'e-mail de confirmação sem o link');
    linkTokens.add(match[1]);
    return match[1];
  };
  const as = (token?: string) => ({
    get: (p: string) => rec(token ? http().get(`/api${p}`).set(auth(token)) : http().get(`/api${p}`)),
    post: (p: string, body: object = {}) => rec(token ? http().post(`/api${p}`).set(auth(token)).send(body) : http().post(`/api${p}`).send(body)),
  });

  // stdout/stderr do processo inteiro durante o spec (log de requisicao LIGADO): varridos no fim.
  const captured: string[] = [];
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);

  let superToken: string;
  let commonToken: string;
  let memberToken: string;
  let superUserId: number;
  const teamUserIds: number[] = [];
  let memberOrgId: number;
  let memberEmail: string;

  let seq = 0;
  const email = (label: string) => `${label}-${stamp}-${++seq}@${DOMAIN}`;
  const body = (over: Record<string, unknown> = {}) => ({
    applicantName: 'Fulana Solicitante',
    email: email('pedido'),
    phone: '(62) 99999-0000',
    password: SENTINEL,
    claimedRole: 'CONTRAMESTRE',
    groupName: `${NAME} grupo ${++seq}`,
    city: 'Goiânia',
    state: 'GO',
    estimatedStudents: 25,
    message: 'Treinamos na praça.',
    acceptTerms: true,
    adult: true,
    ...over,
  });
  const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
  const countApps = () => prisma.groupApplication.count({ where: { email: { endsWith: `@${DOMAIN}` } } });
  /** Cria um pedido pelo endpoint publico (e-mail LIGADO) SEM confirmar: devolve token + linha UNVERIFIED do banco. */
  const submitUnverified = async (over: Record<string, unknown> = {}) => {
    const b = body(over);
    const res = await pubPost(b);
    assert.equal(res.status, 201, res.text);
    await settle();
    const row = await prisma.groupApplication.findUnique({ where: { statusTokenHash: sha256(res.body.statusToken) } });
    assert.ok(row, 'pedido gravado');
    assert.equal(row.status, 'UNVERIFIED');
    return { token: res.body.statusToken as string, row, body: b };
  };
  /**
   * Fluxo REAL completo (e-mail ligado): pedido -> e-mail de confirmacao em segundo plano -> token do LINK -> POST confirm.
   * Devolve token de acompanhamento + linha PENDING/VERIFIED do banco.
   */
  const submit = async (over: Record<string, unknown> = {}) => {
    const created = await submitUnverified(over);
    const confirmed = await pubConfirm({ token: lastLinkToken(created.row.email) });
    assert.equal(confirmed.status, 200, confirmed.text);
    await settle();
    const row = await prisma.groupApplication.findUniqueOrThrow({ where: { id: created.row.id } });
    assert.equal(row.status, 'PENDING');
    assert.equal(row.emailVerification, 'VERIFIED');
    return { token: created.token, row, body: created.body };
  };
  /** Cria um pedido com o e-mail DESLIGADO (appOff): PENDING + SKIPPED. */
  const submitOff = async (over: Record<string, unknown> = {}) => {
    const b = body(over);
    const res = await pubPostOff(b);
    assert.equal(res.status, 201, res.text);
    await settle();
    const row = await prisma.groupApplication.findUniqueOrThrow({ where: { statusTokenHash: sha256(res.body.statusToken) } });
    return { token: res.body.statusToken as string, row, body: b, res };
  };
  const setNotifiedAt = (date: Date) =>
    prisma.platformSetting.upsert({
      where: { key: TEAM_NOTIFY_SETTING_KEY },
      create: { key: TEAM_NOTIFY_SETTING_KEY, value: date.toISOString() },
      update: { value: date.toISOString() },
    });
  const teamMails = () => mail.sent.filter((m) => m.subject === TEAM_SUBJECT);

  const captures: Record<string, unknown> = {};

  before(async () => {
    process.env.REQUEST_LOG = 'true';
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (outWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      captured.push(String(chunk));
      return (errWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;

    app = await createTestApp({ mailTransport: mail });
    appOff = await createTestApp();
    service = app.get(GroupApplicationsService);
    serviceOff = appOff.get(GroupApplicationsService);
    originalNotifySetting = await prisma.platformSetting.findUnique({ where: { key: TEAM_NOTIFY_SETTING_KEY }, select: { value: true } });
    const superAdmin = await createPlatformUser(prisma, `${TEAM_TAG}-super`, { isSuperAdmin: true });
    const common = await createPlatformUser(prisma, `${TEAM_TAG}-common`);
    superUserId = superAdmin.id;
    teamUserIds.push(superAdmin.id, common.id);
    superToken = await platformLogin(app, superAdmin.email);
    commonToken = await platformLogin(app, common.email);

    memberOrgId = (
      await prisma.organization.create({
        data: { name: `${NAME} fixture`, slug: `e2e-adesao-fixture-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    memberEmail = `member-${stamp}@${DOMAIN}`;
    const member = await prisma.user.create({
      data: { email: memberEmail, passwordHash: await bcrypt.hash(TEAM_PASSWORD, 4), name: 'Mestre fixture', userType: 'MEMBER', status: 'ACTIVE' },
    });
    teamUserIds.push(member.id);
    await prisma.organizationUser.create({ data: { organizationId: memberOrgId, userId: member.id, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    memberToken = (await request(app.getHttpServer()).post('/api/auth/login').send({ email: memberEmail, password: TEAM_PASSWORD }).expect(200)).body.accessToken;
  });

  after(async () => {
    process.stdout.write = outWrite as typeof process.stdout.write;
    process.stderr.write = errWrite as typeof process.stderr.write;
    process.env = { ...envBackup };
    await settle();
    await app.close();
    await appOff.close();
    if (originalNotifySetting) {
      await prisma.platformSetting.update({ where: { key: TEAM_NOTIFY_SETTING_KEY }, data: { value: originalNotifySetting.value as Prisma.InputJsonValue } });
    } else {
      await prisma.platformSetting.deleteMany({ where: { key: TEAM_NOTIFY_SETTING_KEY } });
    }
    const orgs = await prisma.organization.findMany({ where: { OR: [{ name: { startsWith: NAME } }, { id: memberOrgId }] }, select: { id: true } });
    const orgIds = orgs.map((o) => o.id);
    const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
    const userIds = [...new Set([...users.map((u) => u.id), ...teamUserIds])];
    await prisma.groupApplication.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.groupRole.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  });

  // + emailVerification (contrato de e-mail 1); canResend/resendAvailableAt so em UNVERIFIED.
  const PUBLIC_KEYS = ['createdAt', 'decidedAt', 'emailVerification', 'groupName', 'loginUrl', 'rejectionReason', 'status'];
  const PUBLIC_KEYS_UNVERIFIED = [...PUBLIC_KEYS, 'canResend', 'resendAvailableAt'].sort();
  // + emailVerification, emailVerifiedAt e instagram (contrato de e-mail 1 e 7).
  const ADMIN_KEYS = [
    'applicantName', 'city', 'claimedRole', 'claimedRoleLabel', 'createdAt', 'decidedAt', 'decidedBy', 'email', 'emailVerification',
    'emailVerifiedAt', 'estimatedStudents', 'groupName', 'id', 'instagram', 'internalNote', 'message', 'organization', 'phone',
    'rejectionReason', 'state', 'status',
  ];
  const POST_KEYS = ['emailVerification', 'status', 'statusToken'];

  describe('pedido público', () => {
    it('válido (e-mail LIGADO): 201 { statusToken, status: UNVERIFIED, emailVerification: PENDING }; só hashes no banco; nada de IP/UA; só o e-mail de confirmação', async () => {
      const sentBefore = mail.sent.length;
      const b = body({ email: `  Maiusculas-${stamp}@${DOMAIN.toUpperCase()} `, state: 'go', applicantName: '  Fulana  ' });
      const res = await pubPost(b);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(Object.keys(res.body).sort(), POST_KEYS);
      assert.equal(res.body.status, 'UNVERIFIED');
      assert.equal(res.body.emailVerification, 'PENDING');
      assert.match(res.body.statusToken, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(res.headers['cache-control'], 'no-store');
      captures.post201Unverified = res.body;
      await settle();

      const row = await prisma.groupApplication.findUnique({ where: { statusTokenHash: sha256(res.body.statusToken) } });
      assert.ok(row);
      assert.equal(row.status, 'UNVERIFIED');
      assert.equal(row.email, `maiusculas-${stamp}@${DOMAIN}`);
      assert.equal(row.state, 'GO');
      assert.equal(row.applicantName, 'Fulana');
      assert.equal(row.claimedRole, 'CONTRAMESTRE');
      assert.equal(row.termsVersion, LEGAL_VERSION);
      assert.ok(row.termsAcceptedAt && row.adultDeclaredAt);
      assert.ok(row.passwordHash?.startsWith('$2'), 'bcrypt');
      assert.ok(await bcrypt.compare(SENTINEL, row.passwordHash!));
      const raw = JSON.stringify(row);
      assert.ok(!raw.includes(SENTINEL), 'senha em claro no banco');
      assert.ok(!raw.includes(res.body.statusToken), 'token em claro no banco');
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'GroupApplication'`;
      assert.ok(!columns.some((c) => /ip|agent/i.test(c.column_name)), JSON.stringify(columns));
      // Contrato de e-mail 1 (substitui o "nenhum e-mail no ato do pedido" do contrato original): sai SÓ o e-mail de
      // confirmação, SÓ para o próprio solicitante, com o link de um token PRÓPRIO (≠ acompanhamento; só o sha256 no banco).
      const sent = mail.sent.slice(sentBefore);
      assert.equal(sent.length, 1, sent.map((m) => m.subject).join(' | '));
      assert.equal(sent[0].to, row.email);
      assert.equal(sent[0].subject, VERIFY_SUBJECT);
      const linkToken = lastLinkToken(row.email);
      assert.notEqual(linkToken, res.body.statusToken, 'token do link ≠ token de acompanhamento');
      assert.equal(row.verifyTokenHash, sha256(linkToken), 'só o sha256 do token do link');
      assert.ok(!raw.includes(linkToken), 'token do link em claro no banco');
      assert.ok(sent[0].text.includes(`https://painel.e2e.test/comecar/confirmar/${linkToken}`));
      assert.equal(row.emailVerification, 'PENDING');
      assert.equal(row.verifySentCount, 1);
      assert.ok(row.verifyExpiresAt && Math.abs(row.verifyExpiresAt.getTime() - row.createdAt.getTime() - 24 * 3600_000) < 5_000, 'link vale 24 h');
    });

    it('400 de campo (mensagens em português), corpo vazio e campo extra recusados; nada gravado', async () => {
      const before = await countApps();
      const cases: Array<[string, unknown]> = [
        ['applicantName', 'F'], ['email', 'invalido'], ['phone', 'abc'], ['password', 'curta'], ['password', 'Dev@12345-qualquer'],
        ['claimedRole', 'SUPER_ADMIN'], ['groupName', 'G'], ['city', 'G'], ['state', 'XX'], ['estimatedStudents', -1],
        ['estimatedStudents', 100001], ['message', 'x'.repeat(501)], ['acceptTerms', false], ['adult', false], ['adult', undefined],
      ];
      for (const [field, value] of cases) {
        const res = await pubPost(body({ [field]: value }));
        assert.equal(res.status, 400, `${field}: ${res.text}`);
        const messages = ([] as string[]).concat(res.body.message);
        assert.ok(messages.some((m) => m.startsWith(field)), `${field}: ${res.text}`);
        assert.ok(messages.every((m) => /deve|não pode|is not allowed|should not exist/.test(m)), res.text);
      }
      assert.equal((await pubPost({})).status, 400);
      const extra = await pubPost({ ...body(), isSuperAdmin: true, role: 'MESTRE' });
      assert.equal(extra.status, 400);
      assert.equal(await countApps(), before, 'nenhum pedido gravado por corpo inválido');
    });

    it('honeypot preenchido: o MESMO 201, nada gravado, nenhum e-mail, token não corresponde a nada (404)', async () => {
      const before = await countApps();
      const sentBefore = mail.sent.length;
      const res = await pubPost(body({ website: 'http://spam.example' }));
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body).sort(), POST_KEYS);
      assert.deepEqual([res.body.status, res.body.emailVerification], ['UNVERIFIED', 'PENDING']);
      assert.match(res.body.statusToken, /^[A-Za-z0-9_-]{43}$/);
      await settle();
      assert.equal(await countApps(), before);
      assert.equal(mail.sent.length, sentBefore, 'honeypot não envia e-mail');
      assert.equal((await pubGet(res.body.statusToken)).status, 404);
    });

    it('e-mail com conta, com pedido pendente/aguardando confirmação ou acima de 3 em 30 dias: MESMA resposta 201, nada criado, nenhum e-mail, status 404', async () => {
      const shape = (r: { status: number; body: Record<string, unknown>; headers: Record<string, unknown> }) => ({
        status: r.status,
        keys: Object.keys(r.body).sort(),
        tokenLength: String(r.body.statusToken).length,
        bodyStatus: r.body.status,
        emailVerification: r.body.emailVerification,
        cache: r.headers['cache-control'],
        type: r.headers['content-type'],
      });
      const fresh = await pubPost(body());
      const reference = shape(fresh);
      assert.deepEqual([reference.bodyStatus, reference.emailVerification], ['UNVERIFIED', 'PENDING']);
      await settle();

      // 1) e-mail que JA tem conta (outra caixa): mesma resposta, nada gravado, NENHUM e-mail para a conta existente
      const before = await countApps();
      const existing = await pubPost(body({ email: memberEmail.toUpperCase() }));
      await settle();
      assert.deepEqual(shape(existing), reference);
      assert.equal(await countApps(), before);
      assert.equal(await prisma.groupApplication.count({ where: { email: memberEmail } }), 0);
      assert.equal(mail.to(memberEmail).length, 0, 'nenhum e-mail para o dono da conta existente');
      assert.equal((await pubGet(existing.body.statusToken)).status, 404);

      // 1b) idem com o e-mail DESLIGADO: a resposta muda SÓ pela configuração (PENDING/SKIPPED), nunca pelo e-mail existir
      const offFresh = await pubPostOff(body());
      const offExisting = await pubPostOff(body({ email: memberEmail }));
      await settle();
      assert.deepEqual(shape(offExisting), shape(offFresh));
      assert.deepEqual([shape(offFresh).bodyStatus, shape(offFresh).emailVerification], ['PENDING', 'SKIPPED']);
      assert.equal(await prisma.groupApplication.count({ where: { email: memberEmail } }), 0);

      // 2) e-mail com pedido PENDENTE (já confirmado) e com pedido UNVERIFIED (aguardando confirmação)
      const { body: pendingBody } = await submit();
      const pendingSent = mail.to(pendingBody.email as string).length;
      const dup = await pubPost(body({ email: (pendingBody.email as string).toUpperCase(), groupName: `${NAME} duplicado` }));
      await settle();
      assert.deepEqual(shape(dup), reference);
      assert.equal(await prisma.groupApplication.count({ where: { email: pendingBody.email as string } }), 1);
      assert.equal(mail.to(pendingBody.email as string).length, pendingSent, 'pedido duplicado não envia e-mail');
      assert.equal((await pubGet(dup.body.statusToken)).status, 404);
      const { row: unverifiedRow } = await submitUnverified();
      const unverifiedSent = mail.to(unverifiedRow.email).length;
      const dup2 = await pubPost(body({ email: unverifiedRow.email }));
      await settle();
      assert.deepEqual(shape(dup2), reference);
      assert.equal(await prisma.groupApplication.count({ where: { email: unverifiedRow.email } }), 1);
      assert.equal(mail.to(unverifiedRow.email).length, unverifiedSent, 'pedido duplicado (UNVERIFIED) não reenvia');
      assert.equal((await pubGet(dup2.body.statusToken)).status, 404);

      // 3) teto: 3 pedidos em 30 dias (os anteriores ja decididos) => o 4o nao grava
      const capped = email('teto');
      for (let i = 0; i < 3; i += 1) {
        const { row } = await submit({ email: capped });
        await prisma.groupApplication.update({ where: { id: row.id }, data: { status: 'REJECTED', passwordHash: null, decidedAt: new Date() } });
      }
      const fourth = await pubPost(body({ email: capped }));
      assert.deepEqual(shape(fourth), reference);
      assert.equal(await prisma.groupApplication.count({ where: { email: capped } }), 3);
      assert.equal((await pubGet(fourth.body.statusToken)).status, 404);
    });

    it('dois pedidos simultâneos com o mesmo e-mail: os dois 201, só UM gravado (índice único parcial UNVERIFIED/PENDING)', async () => {
      const same = email('corrida');
      const results = await Promise.all([pubPost(body({ email: same })), pubPost(body({ email: same }))]);
      assert.deepEqual(results.map((r) => r.status), [201, 201]);
      await settle();
      // o novo fluxo nasce UNVERIFIED (e-mail ligado); antes era PENDING
      assert.equal(await prisma.groupApplication.count({ where: { email: same, status: { in: ['UNVERIFIED', 'PENDING'] } } }), 1);
      assert.equal(verifyMails(same).length, 1, 'um único e-mail de confirmação');
    });
  });

  describe('acompanhamento por token', () => {
    it('PENDING (e-mail confirmado): só as chaves do contrato (+ emailVerification), sem Authorization, no-store; 404 uniforme para mal formado/inexistente', async () => {
      const { token, body: b } = await submit();
      const res = await pubGet(token);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(Object.keys(res.body).sort(), PUBLIC_KEYS);
      assert.equal(res.body.status, 'PENDING');
      assert.equal(res.body.groupName, b.groupName);
      assert.equal(res.body.decidedAt, null);
      assert.equal(res.body.rejectionReason, null);
      assert.equal(res.body.loginUrl, null);
      assert.equal(res.headers['cache-control'], 'no-store');
      for (const leak of [b.email, b.phone, b.applicantName, b.message]) assert.ok(!res.text.includes(String(leak)), String(leak));
      assert.equal(res.body.emailVerification, 'VERIFIED');
      captures.statusPendingVerified = res.body;

      const notFound = await pubGet('A'.repeat(43));
      assert.equal(notFound.status, 404);
      for (const bad of ['abc', 'A'.repeat(44), `${token.slice(0, 42)}%2F`, `${token.slice(0, 42)}.`]) {
        const r = await pubGet(bad);
        assert.equal(r.status, 404, bad);
        assert.deepEqual(r.body, notFound.body, `404 uniforme (${bad})`);
      }
      assert.equal(notFound.body.message, 'Pedido não encontrado.');
    });
  });

  describe('plataforma: permissões', () => {
    it('sem token 401; MEMBER 403 em tudo; PLATFORM comum lê mas NÃO decide (403, pedido intacto); públicos sem token ok', async () => {
      const { row } = await submit();
      for (const p of ['/platform-group-applications', '/platform-group-applications/pending-count', `/platform-group-applications/${row.id}`]) {
        assert.equal((await as().get(p)).status, 401, p);
        assert.equal((await as(memberToken).get(p)).status, 403, p);
        assert.equal((await as(commonToken).get(p)).status, 200, p);
      }
      for (const [p, b] of [[`/platform-group-applications/${row.id}/approve`, {}], [`/platform-group-applications/${row.id}/reject`, { reason: 'Motivo qualquer' }]] as const) {
        assert.equal((await as().post(p, b)).status, 401, p);
        assert.equal((await as(memberToken).post(p, b)).status, 403, p);
        assert.equal((await as(commonToken).post(p, b)).status, 403, p);
        // 403 ANTES da validacao: corpo invalido tambem e 403 para quem nao e super admin
        assert.equal((await as(commonToken).post(p, { lixo: 1 })).status, 403, p);
      }
      const after = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.status, 'PENDING');
      assert.ok(after.passwordHash);
    });
  });

  describe('plataforma: lista, detalhe e contador', () => {
    it('lista: array + X-Total-Count, campos exatos (sem hash/token), PENDING primeiro (mais antigos primeiro), filtros e busca', async () => {
      const res = await as(commonToken).get(`/platform-group-applications?q=${encodeURIComponent(DOMAIN)}&limit=200`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.headers['x-total-count'], String(await countApps()));
      for (const item of res.body) {
        assert.deepEqual(Object.keys(item).sort(), ADMIN_KEYS);
        assert.ok(!('passwordHash' in item) && !('statusTokenHash' in item) && !('statusToken' in item));
      }
      const statuses = res.body.map((i: { status: string }) => i.status);
      const firstOther = statuses.findIndex((s: string) => s !== 'PENDING');
      assert.ok(firstOther === -1 || statuses.slice(firstOther).every((s: string) => s !== 'PENDING'), statuses.join(','));
      const pendingDates = res.body.filter((i: { status: string }) => i.status === 'PENDING').map((i: { createdAt: string }) => i.createdAt);
      assert.deepEqual(pendingDates, [...pendingDates].sort(), 'PENDING do mais antigo para o mais novo');
      const otherDates = res.body.filter((i: { status: string }) => i.status !== 'PENDING').map((i: { createdAt: string }) => i.createdAt);
      assert.deepEqual(otherDates, [...otherDates].sort().reverse(), 'demais por createdAt desc');
      assert.equal(res.body.find((i: { claimedRole: string }) => i.claimedRole === 'CONTRAMESTRE')?.claimedRoleLabel, 'Contramestre');

      const rejected = await as(commonToken).get(`/platform-group-applications?status=REJECTED&q=${encodeURIComponent(DOMAIN)}`);
      assert.ok(rejected.body.length >= 3 && rejected.body.every((i: { status: string }) => i.status === 'REJECTED'));
      // curingas do texto digitado sao escapados ("%" nao casa tudo)
      const wildcard = await as(commonToken).get('/platform-group-applications?q=%25');
      assert.equal(wildcard.status, 200);
      assert.ok(wildcard.body.every((i: { groupName: string; email: string; applicantName: string; city: string }) =>
        [i.groupName, i.email, i.applicantName, i.city].some((v) => v.includes('%'))));
      const paged = await as(commonToken).get(`/platform-group-applications?q=${encodeURIComponent(DOMAIN)}&limit=1&offset=1`);
      assert.equal(paged.body.length, 1);
      assert.equal(paged.body[0].id, res.body[1].id);
      assert.equal((await as(commonToken).get('/platform-group-applications?status=XPTO')).status, 400);
    });

    it('detalhe 404/400, contador = PENDING do banco', async () => {
      assert.equal((await as(commonToken).get('/platform-group-applications/999999999')).status, 404);
      assert.equal((await as(commonToken).get('/platform-group-applications/9999999999')).status, 404);
      assert.equal((await as(commonToken).get('/platform-group-applications/abc')).status, 400);
      const count = await as(commonToken).get('/platform-group-applications/pending-count');
      assert.deepEqual(count.body, { count: await prisma.groupApplication.count({ where: { status: 'PENDING' } }) });
    });
  });

  describe('plataforma: decisões', () => {
    it('APROVAR: cria grupo + MESTRE + Matriz + 4 cargos numa transação; LOGIN REAL com a senha do pedido; status público APPROVED; e-mail sem senha', async () => {
      const { token, row, body: b } = await submit({ claimedRole: 'PROFESSOR', phone: '(11) 98888-7777' });
      const sentBefore = mail.sent.length;
      const res = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, { internalNote: 'Conferido por telefone.' });
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(Object.keys(res.body).sort(), ['application', 'organization']);
      assert.deepEqual(Object.keys(res.body.application).sort(), ADMIN_KEYS);
      assert.equal(res.body.application.status, 'APPROVED');
      assert.deepEqual(res.body.application.decidedBy, { id: superUserId, name: res.body.application.decidedBy.name });
      assert.equal(res.body.application.internalNote, 'Conferido por telefone.');
      const orgRef = res.body.organization;
      assert.deepEqual(Object.keys(orgRef).sort(), ['id', 'name', 'slug']);
      assert.deepEqual(res.body.application.organization, orgRef);

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgRef.id } });
      assert.equal(org.name, b.groupName);
      assert.equal(org.type, 'GROUP');
      assert.equal(org.status, 'ACTIVE');
      assert.equal(org.mapVisible, true);
      assert.equal(org.city, b.city);
      assert.equal(org.state, 'GO');
      const memberships = await prisma.organizationUser.findMany({ where: { organizationId: org.id }, include: { user: true } });
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0].role, 'MESTRE', 'cargo informado (PROFESSOR) NÃO vira papel: quem é aprovado é MESTRE');
      assert.equal(memberships[0].status, 'ACTIVE');
      assert.equal(memberships[0].user.email, b.email);
      assert.equal(memberships[0].user.userType, 'MEMBER');
      assert.equal(memberships[0].user.isSuperAdmin, false);
      assert.equal(memberships[0].user.phone, '(11) 98888-7777');
      assert.equal(memberships[0].user.acceptedTermsVersion, LEGAL_VERSION);
      assert.equal(memberships[0].user.passwordHash, row.passwordHash, 'o hash do pedido vira a senha da conta');
      const units = await prisma.unit.findMany({ where: { organizationId: org.id } });
      assert.deepEqual(units.map((u) => [u.name, u.isMain, u.status]), [['Matriz', true, 'ACTIVE']]);
      assert.equal(await prisma.groupRole.count({ where: { organizationId: org.id } }), 4);

      const stored = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(stored.status, 'APPROVED');
      assert.equal(stored.passwordHash, null, 'hash apagado ao aprovar');
      assert.equal(stored.organizationId, org.id);
      assert.equal(stored.decidedByUserId, superUserId);

      // LOGIN REAL do MESTRE criado, com a senha escolhida no pedido
      const login = await rec(http().post('/api/auth/login').send({ email: b.email, password: SENTINEL }));
      assert.equal(login.status, 200, login.text);
      assert.equal(login.body.user.organizationId, org.id);
      assert.equal(login.body.user.role, 'MESTRE');
      assert.equal((await rec(http().post('/api/auth/login').send({ email: b.email, password: `${SENTINEL}x` }))).status, 401);

      const pub = await pubGet(token);
      assert.equal(pub.status, 200);
      assert.deepEqual(Object.keys(pub.body).sort(), PUBLIC_KEYS);
      assert.equal(pub.body.status, 'APPROVED');
      assert.equal(pub.body.loginUrl, 'https://painel.e2e.test/login');
      assert.equal(pub.body.rejectionReason, null);
      assert.ok(pub.body.decidedAt);
      captures.statusApproved = pub.body;

      const sent = mail.sent.slice(sentBefore);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, b.email);
      assert.equal(sent[0].subject, 'Seu grupo foi aprovado - GingApp');
      assert.ok(sent[0].text.includes('https://painel.e2e.test/login'));

      const audit = await prisma.auditLog.findMany({ where: { action: 'GROUP_APPLICATION_APPROVE', resourceId: String(row.id) } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].resource, 'group_application');
      assert.equal(audit[0].userId, superUserId);
      assert.equal(audit[0].organizationId, org.id);
      assert.deepEqual(Object.keys(audit[0].metadata as object).sort(), ['organizationId', 'status']);
      assert.equal(await prisma.auditLog.count({ where: { action: 'ORGANIZATION_CREATE', organizationId: org.id } }), 1, 'núcleo único: mesma auditoria do POST /organizations');

      // decidido: nem aprovar nem rejeitar de novo
      const again = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, {});
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'NOT_PENDING');
      const rej = await as(superToken).post(`/platform-group-applications/${row.id}/reject`, { reason: 'Tarde demais' });
      assert.equal(rej.status, 409);
      assert.equal(rej.body.code, 'NOT_PENDING');
      assert.equal(await prisma.organization.count({ where: { name: b.groupName as string } }), 1);
    });

    it('aprovar com slug explícito: usado; slug em uso = 409 SLUG_TAKEN e nada criado (pedido segue PENDING com o hash)', async () => {
      const { row } = await submit();
      const slug = `e2e-adesao-${stamp}`;
      const ok = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, { slug });
      assert.equal(ok.status, 201, ok.text);
      assert.equal(ok.body.organization.slug, slug);

      const { row: other, body: b2 } = await submit();
      const taken = await as(superToken).post(`/platform-group-applications/${other.id}/approve`, { slug });
      assert.equal(taken.status, 409, taken.text);
      assert.equal(taken.body.code, 'SLUG_TAKEN');
      assert.equal(await prisma.organization.count({ where: { name: b2.groupName as string } }), 0);
      assert.equal(await prisma.user.count({ where: { email: b2.email as string } }), 0, 'nenhum usuário órfão');
      const still = await prisma.groupApplication.findUniqueOrThrow({ where: { id: other.id } });
      assert.equal(still.status, 'PENDING');
      assert.ok(still.passwordHash);
      assert.equal((await as(superToken).post(`/platform-group-applications/${other.id}/approve`, { slug: 'Slug Invalido' })).status, 400);
      assert.equal((await as(superToken).post('/platform-group-applications/999999999/approve', {})).status, 404);
    });

    it('EMAIL_TAKEN: o e-mail virou conta depois do pedido = 409, nada criado, pedido segue PENDING', async () => {
      const { row, body: b } = await submit();
      const intruder = await prisma.user.create({
        data: { email: (b.email as string).toUpperCase(), passwordHash: await bcrypt.hash('x', 4), name: 'Conta criada no meio-tempo', userType: 'MEMBER' },
      });
      teamUserIds.push(intruder.id);
      const res = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, {});
      assert.equal(res.status, 409, res.text);
      assert.equal(res.body.code, 'EMAIL_TAKEN');
      assert.equal(await prisma.organization.count({ where: { name: b.groupName as string } }), 0);
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');
    });

    it('2 aprovações SIMULTÂNEAS do mesmo pedido: 1 vence (201), a outra 409; um único grupo', async () => {
      const { row, body: b } = await submit();
      const results = await Promise.all([
        as(superToken).post(`/platform-group-applications/${row.id}/approve`, {}),
        as(superToken).post(`/platform-group-applications/${row.id}/approve`, {}),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], results.map((r) => r.text).join(' | '));
      const loser = results.find((r) => r.status === 409)!;
      assert.equal(loser.body.code, 'NOT_PENDING', loser.text);
      assert.equal(await prisma.organization.count({ where: { name: b.groupName as string } }), 1);
      assert.equal(await prisma.user.count({ where: { email: b.email as string } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: 'GROUP_APPLICATION_APPROVE', resourceId: String(row.id) } }), 1);
    });

    it('REJEITAR: motivo obrigatório; 200; motivo aparece no status público; hash apagado; e-mail com o motivo; auditoria sem texto', async () => {
      const { token, row, body: b } = await submit();
      assert.equal((await as(superToken).post(`/platform-group-applications/${row.id}/reject`, {})).status, 400);
      assert.equal((await as(superToken).post(`/platform-group-applications/${row.id}/reject`, { reason: 'ab' })).status, 400);
      assert.equal((await as(superToken).post('/platform-group-applications/999999999/reject', { reason: 'Motivo válido' })).status, 404);
      const reason = `Não encontramos o grupo ${stamp}; envie o Instagram.`;
      const sentBefore = mail.sent.length;
      const res = await as(superToken).post(`/platform-group-applications/${row.id}/reject`, { reason, internalNote: `nota-interna-${stamp}` });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(Object.keys(res.body).sort(), ADMIN_KEYS);
      assert.equal(res.body.status, 'REJECTED');
      assert.equal(res.body.rejectionReason, reason);
      assert.equal(res.body.organization, null);
      const stored = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(stored.passwordHash, null);
      assert.equal(await prisma.organization.count({ where: { name: b.groupName as string } }), 0);

      const pub = await pubGet(token);
      assert.equal(pub.body.status, 'REJECTED');
      assert.equal(pub.body.rejectionReason, reason);
      assert.equal(pub.body.loginUrl, null);
      assert.ok(!pub.text.includes(`nota-interna-${stamp}`), 'nota interna nunca no público');
      captures.statusRejected = pub.body;

      const sent = mail.sent.slice(sentBefore);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, b.email);
      assert.ok(sent[0].text.includes(reason));
      assert.ok(sent[0].text.includes('https://painel.e2e.test/comecar'));

      const audit = await prisma.auditLog.findMany({ where: { action: 'GROUP_APPLICATION_REJECT', resourceId: String(row.id) } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].organizationId, null);
      assert.deepEqual(audit[0].metadata, { status: 'REJECTED' });
    });

    it('falha de envio do e-mail NUNCA desfaz a decisão', async () => {
      const { row } = await submit();
      mail.failNext = true;
      const res = await as(superToken).post(`/platform-group-applications/${row.id}/reject`, { reason: 'Dados incompletos' });
      assert.equal(res.status, 200, res.text);
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } })).status, 'REJECTED');
      const { row: row2 } = await submit();
      mail.failNext = true;
      const ok = await as(superToken).post(`/platform-group-applications/${row2.id}/approve`, {});
      assert.equal(ok.status, 201, ok.text);
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row2.id } })).status, 'APPROVED');
    });
  });

  describe('banco e retenção', () => {
    it('CHECKs do banco: PENDING sem hash e UF inválida são recusados; 2 PENDING com o mesmo e-mail (outra caixa) também', async () => {
      const base = {
        applicantName: 'X', email: email('check'), claimedRole: 'OUTRO' as const, groupName: `${NAME} check`, city: 'C', state: 'SP',
        termsVersion: LEGAL_VERSION, termsAcceptedAt: new Date(), adultDeclaredAt: new Date(),
      };
      await assert.rejects(prisma.groupApplication.create({ data: { ...base, statusTokenHash: sha256(`a${stamp}`), passwordHash: null } }));
      await assert.rejects(prisma.groupApplication.create({ data: { ...base, statusTokenHash: sha256(`b${stamp}`), passwordHash: 'h', state: 'sp' } }));
      await prisma.groupApplication.create({ data: { ...base, statusTokenHash: sha256(`c${stamp}`), passwordHash: 'h' } });
      await assert.rejects(prisma.groupApplication.create({ data: { ...base, email: base.email.toUpperCase(), statusTokenHash: sha256(`d${stamp}`), passwordHash: 'h' } }));
      // decidido sem hash pode
      await prisma.groupApplication.create({ data: { ...base, status: 'REJECTED', statusTokenHash: sha256(`e${stamp}`), passwordHash: null } });

      // contrato de e-mail 1 e 7 (migrations 20261109000000/000100): UNVERIFIED exige o hash; UNVERIFIED só com
      // verificação PENDING; 1 pedido ABERTO (UNVERIFIED ou PENDING) por e-mail; instagram só handle puro
      const other = { ...base, email: email('check2') };
      await assert.rejects(prisma.groupApplication.create({ data: { ...other, status: 'UNVERIFIED', statusTokenHash: sha256(`f${stamp}`), passwordHash: null } }));
      await assert.rejects(
        prisma.groupApplication.create({ data: { ...other, status: 'UNVERIFIED', emailVerification: 'SKIPPED', statusTokenHash: sha256(`g${stamp}`), passwordHash: 'h' } }),
      );
      await prisma.groupApplication.create({ data: { ...other, status: 'UNVERIFIED', statusTokenHash: sha256(`h${stamp}`), passwordHash: 'h' } });
      await assert.rejects(prisma.groupApplication.create({ data: { ...other, email: other.email.toUpperCase(), statusTokenHash: sha256(`i${stamp}`), passwordHash: 'h' } }));
      for (const [i, bad] of ['https://instagram.com/x', '@meugrupo', 'Maiuscula', 'a..b', 'fim.', 'a'.repeat(31)].entries()) {
        await assert.rejects(
          prisma.groupApplication.create({ data: { ...base, email: email(`ig${i}`), instagram: bad, statusTokenHash: sha256(`ig${i}${stamp}`), passwordHash: 'h' } }),
          bad,
        );
      }
      // o índice antigo (só PENDING) foi trocado pelo novo (UNVERIFIED + PENDING)
      const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'GroupApplication'`;
      assert.ok(!indexes.some((ix) => ix.indexname === 'GroupApplication_email_pending_key'), 'índice antigo removido');
      const open = indexes.find((ix) => ix.indexname === 'GroupApplication_email_open_key');
      assert.ok(open && /UNIQUE/.test(open.indexdef) && /UNVERIFIED/.test(open.indexdef) && /PENDING/.test(open.indexdef), JSON.stringify(indexes));
    });

    it('retenção: false desliga; dry-run (padrão) só conta; true expira PENDING > 60 d e apaga REJECTED/EXPIRED > 90 d e APPROVED > 180 d', async () => {
      const now = new Date();
      const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      const mk = (label: string, status: GroupApplicationStatus, createdAt: Date, decidedAt: Date | null) =>
        prisma.groupApplication.create({
          data: {
            applicantName: label, email: email(label), claimedRole: 'MESTRE', groupName: `${NAME} ret ${label}`, city: 'C', state: 'SP',
            termsVersion: LEGAL_VERSION, termsAcceptedAt: createdAt, adultDeclaredAt: createdAt, statusTokenHash: sha256(`${label}-${stamp}`),
            passwordHash: status === 'PENDING' ? '$2b$10$fakehashfakehashfakehashfakehashfakehashfakehash' : null,
            status, createdAt, decidedAt,
          },
          select: { id: true },
        });
      const rows = {
        pendingOld: await mk('pold', 'PENDING', days(61), null),
        pendingNew: await mk('pnew', 'PENDING', days(59), null),
        rejectedOld: await mk('rold', 'REJECTED', days(200), days(91)),
        rejectedNew: await mk('rnew', 'REJECTED', days(200), days(89)),
        expiredOld: await mk('eold', 'EXPIRED', days(200), days(95)),
        approvedOld: await mk('aold', 'APPROVED', days(300), days(181)),
        approvedMid: await mk('amid', 'APPROVED', days(300), days(100)),
      };
      const onlyIds = Object.values(rows).map((r) => r.id);
      const job = new GroupApplicationsRetentionCronService(app.get(PrismaService));

      process.env.GROUP_APPLICATIONS_PURGE = 'false';
      assert.equal(await job.run({ onlyIds }), null);
      delete process.env.GROUP_APPLICATIONS_PURGE; // padrao = dry-run
      // expiredUnverified: campo novo do resultado (contrato de e-mail 1); nenhum UNVERIFIED neste conjunto
      assert.deepEqual(await job.run({ onlyIds }), { dryRun: true, expired: 1, expiredUnverified: 0, deleted: 3, hashesCleared: 0 });
      assert.equal(await prisma.groupApplication.count({ where: { id: { in: onlyIds } } }), 7, 'dry-run não apaga');
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: rows.pendingOld.id } })).status, 'PENDING');

      process.env.GROUP_APPLICATIONS_PURGE = 'true';
      try {
        assert.deepEqual(await job.run({ onlyIds, now }), { dryRun: false, expired: 1, expiredUnverified: 0, deleted: 3, hashesCleared: 0 });
      } finally {
        process.env.GROUP_APPLICATIONS_PURGE = 'false';
      }
      const left = await prisma.groupApplication.findMany({ where: { id: { in: onlyIds } }, orderBy: { id: 'asc' } });
      assert.deepEqual(left.map((r) => r.id).sort(), [rows.pendingOld.id, rows.pendingNew.id, rows.rejectedNew.id, rows.approvedMid.id].sort());
      const expired = left.find((r) => r.id === rows.pendingOld.id)!;
      assert.equal(expired.status, 'EXPIRED');
      assert.equal(expired.passwordHash, null);
      assert.ok(expired.decidedAt && expired.decidedAt.getTime() === now.getTime());
      assert.equal(left.find((r) => r.id === rows.pendingNew.id)!.status, 'PENDING');
    });
  });

  // -------------------------------------------------------------------------------------------------------------
  // docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md secoes 1, 2, 6 e 7
  // -------------------------------------------------------------------------------------------------------------

  describe('confirmação do e-mail (e-mail LIGADO × DESLIGADO)', () => {
    it('e-mail DESLIGADO: 201 { status: PENDING, emailVerification: SKIPPED }; nenhum e-mail; status público sem reenvio; aprovável', async () => {
      const sentBefore = mail.sent.length;
      const { token, row, res } = await submitOff({ instagram: '' });
      assert.deepEqual(Object.keys(res.body).sort(), POST_KEYS);
      assert.deepEqual([res.body.status, res.body.emailVerification], ['PENDING', 'SKIPPED']);
      captures.post201Pending = res.body;
      assert.equal(row.status, 'PENDING');
      assert.equal(row.emailVerification, 'SKIPPED');
      assert.equal(row.verifyTokenHash, null);
      assert.equal(row.verifySentCount, 0);
      assert.equal(row.instagram, null, 'instagram vazio = null');
      assert.equal(mail.sent.length, sentBefore, 'nenhum e-mail com o envio desligado (nem ao solicitante nem à equipe)');

      const pub = await rec(httpOff().get(`/api/public/group-applications/${token}`));
      assert.equal(pub.status, 200);
      assert.deepEqual(Object.keys(pub.body).sort(), PUBLIC_KEYS);
      assert.equal(pub.body.emailVerification, 'SKIPPED');
      captures.statusPendingSkipped = pub.body;

      // resend neutro (204) e confirm 404 com o envio desligado
      assert.equal((await rec(httpOff().post(`/api/public/group-applications/${token}/resend`))).status, 204);
      assert.equal((await rec(httpOff().post('/api/public/group-applications/confirm').send({ token }))).status, 404);
      await settle();
      assert.equal(mail.sent.length, sentBefore);

      // SKIPPED é aprovável (a equipe confere com mais cuidado)
      const list = await as(commonToken).get(`/platform-group-applications/${row.id}`);
      assert.equal(list.body.emailVerification, 'SKIPPED');
      assert.equal(list.body.emailVerifiedAt, null);
      const ok = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, {});
      assert.equal(ok.status, 201, ok.text);
      // recriar um SKIPPED para aparecer como PENDING na captura do admin
      const again = await submitOff();
      captures.skippedId = again.row.id;
    });

    it('UNVERIFIED: status público com canResend/resendAvailableAt (sem e-mail); aprovar = 409 EMAIL_NOT_VERIFIED; rejeitar = 409 NOT_PENDING; não conta no pending-count', async () => {
      const countBefore = (await as(commonToken).get('/platform-group-applications/pending-count')).body.count;
      const { token, row, body: b } = await submitUnverified({ instagram: '@Grupo.Da_Praca' });
      captures.unverifiedId = row.id;
      const pub = await pubGet(token);
      assert.equal(pub.status, 200);
      assert.deepEqual(Object.keys(pub.body).sort(), PUBLIC_KEYS_UNVERIFIED);
      assert.equal(pub.body.status, 'UNVERIFIED');
      assert.equal(pub.body.emailVerification, 'PENDING');
      assert.equal(pub.body.canResend, false, 'acabou de enviar: espera 5 min');
      const available = new Date(pub.body.resendAvailableAt).getTime();
      assert.ok(Math.abs(available - (row.verifySentAt!.getTime() + 5 * 60_000)) < 1000, pub.text);
      for (const leak of [b.email, b.applicantName, 'grupo.da_praca', 'Grupo.Da_Praca']) assert.ok(!pub.text.includes(String(leak)), String(leak));
      captures.statusUnverified = pub.body;

      const approve = await as(superToken).post(`/platform-group-applications/${row.id}/approve`, {});
      assert.equal(approve.status, 409, approve.text);
      assert.equal(approve.body.code, 'EMAIL_NOT_VERIFIED');
      assert.match(approve.body.message, /confirmou o e-mail/);
      const reject = await as(superToken).post(`/platform-group-applications/${row.id}/reject`, { reason: 'Motivo qualquer' });
      assert.equal(reject.status, 409);
      assert.equal(reject.body.code, 'NOT_PENDING');
      const still = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(still.status, 'UNVERIFIED');
      assert.ok(still.passwordHash);
      assert.equal(await prisma.organization.count({ where: { name: b.groupName as string } }), 0);

      const count = await as(commonToken).get('/platform-group-applications/pending-count');
      assert.equal(count.body.count, countBefore, 'UNVERIFIED não conta no pending-count');
      assert.deepEqual(count.body, { count: await prisma.groupApplication.count({ where: { status: 'PENDING' } }) });
      const tab = await as(commonToken).get(`/platform-group-applications?status=UNVERIFIED&q=${encodeURIComponent(DOMAIN)}&limit=200`);
      assert.equal(tab.status, 200);
      assert.ok(tab.body.length >= 1 && tab.body.every((i: { status: string }) => i.status === 'UNVERIFIED'));
      const item = tab.body.find((i: { id: number }) => i.id === row.id);
      assert.deepEqual(Object.keys(item).sort(), ADMIN_KEYS);
      assert.equal(item.emailVerification, 'PENDING');
      assert.equal(item.instagram, 'grupo.da_praca', 'admin vê o handle normalizado');
    });

    it('confirmar: token certo = 200 { status: PENDING } (VERIFIED, hash do link apagado); errado/mal formado/vencido/reusado = 404 uniforme; GET não confirma', async () => {
      const { token, row } = await submitUnverified();
      const linkToken = lastLinkToken(row.email);

      // GET nunca confirma: nem o path do painel (cai no acompanhamento = 404) nem com o token na query
      const viaGet = await rec(http().get(`/api/public/group-applications/confirm?token=${linkToken}`));
      assert.equal(viaGet.status, 404);
      assert.equal((await rec(http().get(`/api/public/group-applications/${linkToken}`))).status, 404, 'token do link não abre o acompanhamento');
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } })).status, 'UNVERIFIED', 'GET não mudou nada');

      const wrong = await pubConfirm({ token: 'A'.repeat(43) });
      assert.equal(wrong.status, 404);
      assert.match(wrong.body.message, /Link inválido ou vencido/);
      captures.confirm404 = wrong.body;
      for (const bad of ['abc', 'A'.repeat(44), `${linkToken.slice(0, 42)}.`, token]) {
        const r = await pubConfirm({ token: bad });
        assert.equal(r.status, 404, bad);
        assert.deepEqual(r.body, wrong.body, `404 uniforme (${bad === token ? 'token de acompanhamento' : bad})`);
      }
      assert.equal((await pubConfirm({})).status, 400);
      assert.equal((await pubConfirm({ token: 5 })).status, 400);
      assert.equal((await pubConfirm({ token: linkToken, extra: 1 })).status, 400);

      const ok = await pubConfirm({ token: linkToken });
      assert.equal(ok.status, 200, ok.text);
      assert.deepEqual(ok.body, { status: 'PENDING' });
      assert.equal(ok.headers['cache-control'], 'no-store');
      captures.confirm200 = ok.body;
      await settle();
      const stored = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(stored.status, 'PENDING');
      assert.equal(stored.emailVerification, 'VERIFIED');
      assert.ok(stored.emailVerifiedAt);
      assert.equal(stored.verifyTokenHash, null);
      assert.ok(stored.passwordHash, 'a senha (hash) continua para a aprovação');

      const reused = await pubConfirm({ token: linkToken });
      assert.equal(reused.status, 404, 'reusar o link = 404');
      assert.deepEqual(reused.body, wrong.body);

      const pub = await pubGet(token);
      assert.deepEqual(Object.keys(pub.body).sort(), PUBLIC_KEYS);
      assert.equal(pub.body.status, 'PENDING');
      assert.equal(pub.body.emailVerification, 'VERIFIED');
      const admin = await as(commonToken).get(`/platform-group-applications/${row.id}`);
      assert.equal(admin.body.emailVerification, 'VERIFIED');
      assert.ok(admin.body.emailVerifiedAt);

      // vencido (mais de 24 h): 404 e o pedido segue UNVERIFIED
      const late = await submitUnverified();
      const lateToken = lastLinkToken(late.row.email);
      await prisma.groupApplication.update({ where: { id: late.row.id }, data: { verifyExpiresAt: new Date(Date.now() - 1000) } });
      const expired = await pubConfirm({ token: lateToken });
      assert.equal(expired.status, 404);
      assert.deepEqual(expired.body, wrong.body);
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: late.row.id } })).status, 'UNVERIFIED');
    });

    it('a resposta do POST NÃO espera o SMTP (envio preso) e falha de envio não muda a resposta', async () => {
      mail.hold = true;
      let res!: request.Response;
      try {
        res = await pubPost(body());
        assert.equal(res.status, 201, 'respondeu com o envio ainda preso');
        const row = await prisma.groupApplication.findUniqueOrThrow({ where: { statusTokenHash: sha256(res.body.statusToken) } });
        assert.equal(verifyMails(row.email).length, 0, 'o e-mail ainda não saiu quando a resposta chegou');
      } finally {
        mail.release();
      }
      await settle();
      const row = await prisma.groupApplication.findUniqueOrThrow({ where: { statusTokenHash: sha256(res.body.statusToken) } });
      assert.equal(verifyMails(row.email).length, 1, 'depois de solto, o e-mail sai');

      mail.failNext = true;
      const failed = await pubPost(body());
      await settle();
      assert.equal(failed.status, 201);
      assert.deepEqual(Object.keys(failed.body).sort(), POST_KEYS);
      assert.equal(failed.body.status, 'UNVERIFIED');
      assert.equal(mail.failNext, false, 'controle: a falha simulada foi consumida pelo envio');
    });

    it('reenviar: só UNVERIFIED; 1 a cada 5 min e no máximo 3 envios (429 em português); token antigo invalidado; resposta neutra', async () => {
      const { token, row } = await submitUnverified();
      const first = lastLinkToken(row.email);
      const back = (minutes: number) =>
        prisma.groupApplication.update({ where: { id: row.id }, data: { verifySentAt: new Date(Date.now() - minutes * 60_000) } });

      // logo depois do pedido: espera de 5 min
      const cooldown = await pubResend(token);
      assert.equal(cooldown.status, 429, cooldown.text);
      assert.equal(cooldown.body.code, 'RESEND_COOLDOWN');
      assert.match(cooldown.body.message, /Aguarde 5 minutos/);
      captures.resend429Cooldown = cooldown.body;

      // 5 min depois: 204, token NOVO, o antigo deixa de valer
      await back(6);
      const canNow = await pubGet(token);
      assert.deepEqual([canNow.body.canResend, canNow.body.resendAvailableAt], [true, null]);
      captures.statusUnverifiedCanResend = canNow.body;
      const ok = await pubResend(token);
      assert.equal(ok.status, 204, ok.text);
      assert.equal(ok.text, '');
      captures.resend204 = { status: ok.status, body: ok.text, cacheControl: ok.headers['cache-control'] };
      await settle();
      const second = lastLinkToken(row.email);
      assert.notEqual(second, first);
      const afterResend = await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(afterResend.verifySentCount, 2);
      assert.equal(afterResend.verifyTokenHash, sha256(second));
      assert.equal(verifyMails(row.email).length, 2);
      assert.equal((await pubConfirm({ token: first })).status, 404, 'link antigo invalidado');

      // 2º reenvio (3º envio) e depois o limite
      assert.equal((await pubResend(token)).status, 429, 'de novo em menos de 5 min');
      await back(6);
      assert.equal((await pubResend(token)).status, 204);
      await settle();
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } })).verifySentCount, 3);
      await back(60);
      const limit = await pubResend(token);
      assert.equal(limit.status, 429);
      assert.equal(limit.body.code, 'RESEND_LIMIT');
      assert.match(limit.body.message, /máximo de 3/);
      captures.resend429Limit = limit.body;
      const exhausted = await pubGet(token);
      assert.deepEqual([exhausted.body.canResend, exhausted.body.resendAvailableAt], [false, null]);
      assert.equal(verifyMails(row.email).length, 3, 'exatamente 3 envios');

      // o último link ainda confirma
      const third = lastLinkToken(row.email);
      assert.equal((await pubConfirm({ token: third })).status, 200);
      await settle();

      // neutro: token desconhecido, mal formado e pedido que não é UNVERIFIED = 204, nada enviado
      const sentBefore = mail.sent.length;
      for (const t of ['B'.repeat(43), 'curto', token]) {
        const r = await pubResend(t);
        assert.equal(r.status, 204, t);
        assert.equal(r.text, '');
      }
      await settle();
      assert.equal(mail.sent.length, sentBefore, 'resposta neutra não envia nada');
    });

    it('expiração: UNVERIFIED com mais de 3 dias vira EXPIRED (senha e hash do link apagados); o de 2 dias fica', async () => {
      const now = new Date();
      const mk = async (days: number) => {
        const { row } = await submitUnverified();
        await prisma.groupApplication.update({ where: { id: row.id }, data: { createdAt: new Date(now.getTime() - days * 24 * 3600_000) } });
        return row;
      };
      const old = await mk(4);
      const recent = await mk(2);
      const onlyIds = [old.id, recent.id];
      const job = new GroupApplicationsRetentionCronService(app.get(PrismaService));
      delete process.env.GROUP_APPLICATIONS_PURGE; // dry-run
      assert.deepEqual(await job.run({ onlyIds, now }), { dryRun: true, expired: 0, expiredUnverified: 1, deleted: 0, hashesCleared: 0 });
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: old.id } })).status, 'UNVERIFIED', 'dry-run não altera');
      process.env.GROUP_APPLICATIONS_PURGE = 'true';
      try {
        assert.deepEqual(await job.run({ onlyIds, now }), { dryRun: false, expired: 0, expiredUnverified: 1, deleted: 0, hashesCleared: 0 });
      } finally {
        process.env.GROUP_APPLICATIONS_PURGE = 'false';
      }
      const expired = await prisma.groupApplication.findUniqueOrThrow({ where: { id: old.id } });
      assert.equal(expired.status, 'EXPIRED');
      assert.equal(expired.passwordHash, null);
      assert.equal(expired.verifyTokenHash, null);
      assert.equal(expired.decidedAt?.getTime(), now.getTime());
      const kept = await prisma.groupApplication.findUniqueOrThrow({ where: { id: recent.id } });
      assert.equal(kept.status, 'UNVERIFIED');
      assert.ok(kept.passwordHash && kept.verifyTokenHash);
      // o link do expirado não confirma mais
      assert.equal((await pubConfirm({ token: lastLinkToken(old.email) })).status, 404);
    });

  });

  describe('aviso à equipe (contrato de e-mail 2)', () => {
    const SPECIFIC = [`equipe-a-${stamp}@${DOMAIN}`, `equipe-b-${stamp}@${DOMAIN}`];

    it('ao confirmar: UM aviso por janela de 10 min, para GROUP_APPLICATIONS_NOTIFY_EMAILS, sem nenhum dado do solicitante', async () => {
      process.env.GROUP_APPLICATIONS_NOTIFY_EMAILS = ` ${SPECIFIC[0].toUpperCase()}, ${SPECIFIC[1]} ;nao-e-email`;
      try {
        await setNotifiedAt(new Date(Date.now() - 11 * 60_000));
        const before = teamMails().length;
        const { body: b, row } = await submit({ instagram: 'instagram.com/aviso_equipe', message: `mensagem-${stamp}` });
        const notices = teamMails().slice(before);
        assert.deepEqual(notices.map((m) => m.to).sort(), [...SPECIFIC].sort(), 'um e-mail para cada destinatário da env');
        for (const m of notices) {
          assert.ok(m.text.includes('Há um novo pedido de adesão aguardando análise'));
          assert.ok(m.text.includes('https://admin.e2e.test/pedidos-de-adesao'));
          for (const leak of [b.applicantName, b.groupName, b.email, row.email, b.city, b.phone, 'aviso_equipe', `mensagem-${stamp}`, String(row.id)]) {
            assert.ok(!`${m.subject}${m.text}${m.html}`.includes(String(leak)), `aviso vazou "${leak}"`);
          }
        }
        // o e-mail de confirmação também não leva texto do solicitante
        for (const m of verifyMails(row.email)) {
          for (const leak of [b.applicantName, b.groupName, 'aviso_equipe', `mensagem-${stamp}`]) {
            assert.ok(!`${m.subject}${m.text}${m.html}`.includes(String(leak)), `confirmação vazou "${leak}"`);
          }
        }

        // dentro da janela: outro pedido confirmado NÃO gera novo aviso
        await submit();
        assert.equal(teamMails().length, before + 2, 'agrupado: nada novo em menos de 10 min');

        // janela vencida + 2 confirmações SIMULTÂNEAS: exatamente UM aviso (reserva atômica da janela)
        await setNotifiedAt(new Date(Date.now() - 11 * 60_000));
        const [x, y] = [await submitUnverified(), await submitUnverified()];
        const beforeRace = teamMails().length;
        const confirms = await Promise.all([pubConfirm({ token: lastLinkToken(x.row.email) }), pubConfirm({ token: lastLinkToken(y.row.email) })]);
        assert.deepEqual(confirms.map((r) => r.status), [200, 200]);
        await settle();
        assert.equal(teamMails().length, beforeRace + 2, 'um único aviso (2 destinatários) para as duas confirmações');
        const stored = await prisma.platformSetting.findUniqueOrThrow({ where: { key: TEAM_NOTIFY_SETTING_KEY } });
        assert.ok(Date.now() - new Date(String(stored.value)).getTime() < 60_000, 'último aviso gravado agora');
      } finally {
        process.env.GROUP_APPLICATIONS_NOTIFY_EMAILS = '';
      }
    });

    it('sem a env: destinatários = super admins PLATFORM ATIVOS; falha de envio não afeta o pedido; e-mail desligado = sem aviso', async () => {
      const inactive = await createPlatformUser(prisma, `${TEAM_TAG}-super-inativo`, { isSuperAdmin: true });
      teamUserIds.push(inactive.id);
      await prisma.user.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
      await setNotifiedAt(new Date(Date.now() - 11 * 60_000));
      const before = teamMails().length;
      await submit();
      const expected = (
        await prisma.user.findMany({ where: { userType: 'PLATFORM', isSuperAdmin: true, status: 'ACTIVE' }, select: { email: true } })
      ).map((u) => u.email.toLowerCase());
      const got = teamMails().slice(before).map((m) => m.to);
      assert.ok(expected.length > 0, 'controle: há super admin ativo');
      assert.deepEqual([...new Set(got)].sort(), [...new Set(expected)].sort());
      assert.ok(!got.includes(inactive.email.toLowerCase()), 'super admin inativo não recebe');
      const common = await prisma.user.findUniqueOrThrow({ where: { id: teamUserIds[1] } });
      assert.ok(!got.includes(common.email.toLowerCase()), 'PLATFORM comum (não super) não recebe');

      // falha no envio do aviso: a confirmação já respondeu 200 e o pedido segue PENDING
      await setNotifiedAt(new Date(Date.now() - 11 * 60_000));
      const { row } = await submitUnverified();
      mail.failNext = true;
      const res = await pubConfirm({ token: lastLinkToken(row.email) });
      await settle();
      assert.equal(res.status, 200);
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: row.id } })).status, 'PENDING');

      // e-mail desligado: pedido nasce PENDING mas não há como avisar (nenhum envio, janela intacta)
      await setNotifiedAt(new Date(Date.now() - 11 * 60_000));
      const sentBefore = mail.sent.length;
      await submitOff();
      assert.equal(mail.sent.length, sentBefore);
      assert.deepEqual(await serviceOff.notifyTeam(), { sent: 0, skipped: 'mail-off' });
    });
  });

  describe('Instagram (contrato de e-mail 7)', () => {
    it('normaliza no servidor e grava só o handle; inválido = 400 com a mensagem do contrato; só a equipe vê', async () => {
      const cases: Array<[string, string]> = [
        ['@MeuGrupo', 'meugrupo'],
        ['https://www.instagram.com/Capoeira.Raiz/?igsh=abc123', 'capoeira.raiz'],
        ['instagr.am/ginga_10', 'ginga_10'],
      ];
      for (const [raw, handle] of cases) {
        const { row, token } = await submitUnverified({ instagram: raw });
        assert.equal(row.instagram, handle, raw);
        const pub = await pubGet(token);
        assert.ok(!pub.text.includes(handle) && !pub.text.toLowerCase().includes('instagram'), 'nunca na resposta pública');
        const admin = await as(commonToken).get(`/platform-group-applications/${row.id}`);
        assert.equal(admin.body.instagram, handle);
        for (const m of verifyMails(row.email)) assert.ok(!`${m.text}${m.html}`.includes(handle), 'nunca em e-mail');
      }
      const before = await countApps();
      for (const bad of ['https://evil.com/meugrupo', 'javascript:alert(1)', 'meu grupo', 'a'.repeat(31), 'https://instagram.com/p/abc']) {
        const res = await pubPost(body({ instagram: bad }));
        assert.equal(res.status, 400, bad);
        assert.deepEqual(([] as string[]).concat(res.body.message), ['Informe o Instagram como @usuario ou o link do perfil.'], bad);
        assert.ok(!res.text.includes('evil.com') && !res.text.includes('alert('), 'mensagem não ecoa o valor');
      }
      assert.equal(await countApps(), before, 'nada gravado');
      // a resposta do POST também nunca leva o instagram
      const post = await pubPost(body({ instagram: '@so_equipe' }));
      assert.deepEqual(Object.keys(post.body).sort(), POST_KEYS);
      assert.ok(!post.text.includes('so_equipe'));
      await settle();
    });
  });

  // Por ULTIMO entre os que fazem POST/GET publicos: estourar o limite BLOQUEIA a rota para este IP pela duracao da janela
  // (o throttler nao desbloqueia ao subir o limite de volta). Movido para depois dos testes do contrato de e-mail.
  describe('throttle', () => {
    it('throttle por IP: POST e GET de status com limites rebaixados => 429', async () => {
      process.env.GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT = '2';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1) statuses.push((await pubPost({})).status);
        assert.equal(statuses[statuses.length - 1], 429, statuses.join(','));
      } finally {
        process.env.GROUP_APPLICATION_SUBMIT_THROTTLE_LIMIT = '5000';
      }
      process.env.GROUP_APPLICATION_STATUS_THROTTLE_LIMIT = '2';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 3; i += 1) statuses.push((await pubGet('A'.repeat(43))).status);
        assert.equal(statuses[statuses.length - 1], 429, statuses.join(','));
      } finally {
        process.env.GROUP_APPLICATION_STATUS_THROTTLE_LIMIT = '5000';
      }
    });

    it('throttle por IP: confirmar e reenviar com limites rebaixados => 429', async () => {
      for (const [name, call] of [
        ['GROUP_APPLICATION_CONFIRM_THROTTLE_LIMIT', () => pubConfirm({ token: 'C'.repeat(43) })],
        ['GROUP_APPLICATION_RESEND_THROTTLE_LIMIT', () => pubResend('D'.repeat(43))],
      ] as const) {
        process.env[name] = '2';
        try {
          const statuses: number[] = [];
          for (let i = 0; i < 3; i += 1) statuses.push((await call()).status);
          assert.equal(statuses[statuses.length - 1], 429, `${name}: ${statuses.join(',')}`);
        } finally {
          process.env[name] = '5000';
        }
      }
    });
  });

  describe('captura e varredura final', () => {
    it('lista do admin com itens de cada status, verificação e instagram (captura com ADESAO_CAPTURE_DIR)', async () => {
      // o EXPIRED vem do teste de retencao acima (PENDING de 61 dias expirado pelo job)
      const res = await as(commonToken).get(`/platform-group-applications?q=${encodeURIComponent(DOMAIN)}&limit=200`);
      assert.equal(res.status, 200);
      const seen = new Set(res.body.map((i: { status: string }) => i.status));
      for (const s of ['UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']) assert.ok(seen.has(s), `lista sem ${s}`);
      for (const item of res.body) assert.deepEqual(Object.keys(item).sort(), ADMIN_KEYS);
      // amostras REAIS (so recortadas), preferindo os pedidos feitos pelo endpoint publico e decididos pela API
      type Item = { id: number; status: string; applicantName: string; decidedBy: unknown; emailVerification: string; instagram: string | null };
      const items = res.body as Item[];
      const viaApi = (i: Item) =>
        i.applicantName === 'Fulana Solicitante' && (['UNVERIFIED', 'PENDING', 'EXPIRED'].includes(i.status) || i.decidedBy !== null);
      const pick = (pred: (i: Item) => boolean, label: string) => {
        const found = items.find((i) => pred(i) && viaApi(i)) ?? items.find(pred);
        assert.ok(found, `amostra ausente: ${label}`);
        return found;
      };
      const samples = {
        unverifiedWithInstagram: items.find((i) => i.id === captures.unverifiedId) ?? pick((i) => i.status === 'UNVERIFIED' && i.instagram !== null, 'UNVERIFIED c/ instagram'),
        pendingVerifiedWithInstagram: pick((i) => i.status === 'PENDING' && i.emailVerification === 'VERIFIED' && i.instagram !== null, 'PENDING VERIFIED c/ instagram'),
        pendingVerifiedWithoutInstagram: pick((i) => i.status === 'PENDING' && i.emailVerification === 'VERIFIED' && i.instagram === null, 'PENDING VERIFIED s/ instagram'),
        pendingSkippedWithoutInstagram:
          items.find((i) => i.id === captures.skippedId) ?? pick((i) => i.status === 'PENDING' && i.emailVerification === 'SKIPPED' && i.instagram === null, 'PENDING SKIPPED'),
        approved: pick((i) => i.status === 'APPROVED', 'APPROVED'),
        rejected: pick((i) => i.status === 'REJECTED', 'REJECTED'),
        expired: pick((i) => i.status === 'EXPIRED', 'EXPIRED'),
      };
      assert.equal(samples.unverifiedWithInstagram.status, 'UNVERIFIED');
      assert.equal(samples.pendingSkippedWithoutInstagram.emailVerification, 'SKIPPED');
      const pendingCount = await as(commonToken).get('/platform-group-applications/pending-count');
      const publicCaptures = [
        'post201Unverified', 'post201Pending', 'statusUnverified', 'statusUnverifiedCanResend', 'statusPendingVerified', 'statusPendingSkipped',
        'statusApproved', 'statusRejected', 'confirm200', 'confirm404', 'resend204', 'resend429Cooldown', 'resend429Limit',
      ];
      for (const required of publicCaptures) assert.ok(captures[required], `captura ${required}`);
      const dir = process.env.ADESAO_CAPTURE_DIR;
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, 'adesao2-real-public.json'),
          `${JSON.stringify(Object.fromEntries(publicCaptures.map((k) => [k, captures[k]])), null, 2)}\n`,
          'utf8',
        );
        await fs.writeFile(
          path.join(dir, 'adesao2-real-admin.json'),
          `${JSON.stringify({ headers: { 'x-total-count': res.headers['x-total-count'] }, pendingCount: pendingCount.body, list: Object.values(samples), samples }, null, 2)}\n`,
          'utf8',
        );
        console.log(`[captura] JSON real gravado em ${dir}`);
      }
    });

    it('SENHA-SENTINELA: nunca em resposta, log (stdout/stderr), auditoria, e-mail nem banco; hash e token também fora das respostas/logs', async () => {
      const responses = seenBodies.join('\n');
      assert.ok(responses.length > 1000, 'controle: as respostas foram coletadas');
      assert.ok(!responses.includes(SENTINEL), 'sentinela numa resposta HTTP');
      assert.ok(!/\$2[aby]\$/.test(responses), 'hash bcrypt numa resposta');
      assert.ok(!/passwordHash|statusTokenHash/.test(responses), 'nome de campo de hash numa resposta');

      const logs = captured.join('');
      const requestLines = (logs.match(/\{"ts":"[^\n]*?"msg":"http_request"[^\n]*?\}(?=\n|$)/g) ?? []).map((l) => JSON.parse(l));
      const publicLines = requestLines.filter((l) => String(l.route).startsWith('/api/public/group-applications'));
      assert.ok(publicLines.length > 10, 'controle: o log de requisição estava ligado');
      for (const l of publicLines) {
        assert.deepEqual([l.userId, l.ip], [null, null], JSON.stringify(l));
        assert.deepEqual(Object.keys(l).sort(), ['level', 'method', 'ms', 'msg', 'requestId', 'route', 'status', 'ts', 'userId', 'ip'].sort());
      }
      const PUBLIC_ROUTES = [
        '/api/public/group-applications',
        '/api/public/group-applications/:token',
        '/api/public/group-applications/confirm',
        '/api/public/group-applications/:token/resend',
      ];
      assert.ok(publicLines.every((l) => PUBLIC_ROUTES.includes(l.route)), JSON.stringify([...new Set(publicLines.map((l) => l.route))]));
      for (const route of PUBLIC_ROUTES) assert.ok(publicLines.some((l) => l.route === route), `controle: ${route} apareceu no log`);
      assert.ok(requestLines.some((l) => String(l.route).startsWith('/api/platform-group-applications') && l.userId !== null), 'plataforma segue com userId');
      assert.ok(!logs.includes(SENTINEL), 'sentinela no log');
      assert.ok(!/\$2[aby]\$10\$/.test(logs), 'hash bcrypt no log');
      const statusTokens = ['post201Unverified', 'post201Pending'].map((k) => (captures[k] as { statusToken: string }).statusToken);
      for (const t of statusTokens) assert.ok(!logs.includes(t), 'token de acompanhamento em claro no log');
      assert.ok(linkTokens.size >= 5, `controle: tokens de link coletados (${linkTokens.size})`);
      for (const t of linkTokens) {
        assert.ok(!logs.includes(t), 'token do LINK de confirmação em claro no log');
        assert.ok(!responses.includes(t), 'token do LINK de confirmação numa resposta HTTP');
      }
      assert.ok(!/verifyTokenHash/.test(responses), 'nome do campo de hash do link numa resposta');

      for (const m of mail.sent) assert.ok(!`${m.subject}${m.text}${m.html}`.includes(SENTINEL), 'sentinela num e-mail');

      const scan = async (table: string, needle: string) =>
        Number(
          (await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "${table}" t WHERE row_to_json(t)::text LIKE $1`, `%${needle}%`))[0].n,
        );
      for (const table of ['AuditLog', 'GroupApplication', 'User', 'Organization']) {
        assert.equal(await scan(table, SENTINEL), 0, `${table} contém a sentinela`);
      }
      const auditRows = await prisma.auditLog.findMany({ where: { action: { startsWith: 'GROUP_APPLICATION_' }, userId: superUserId } });
      assert.ok(auditRows.length >= 4, 'controle: há auditoria das decisões');
      const auditRaw = JSON.stringify(auditRows);
      assert.ok(!/\$2[aby]\$/.test(auditRaw) && !auditRaw.includes(DOMAIN) && !auditRaw.includes('Instagram'), auditRaw);
      // controle positivo da varredura: acha o que existe
      assert.ok((await scan('GroupApplication', DOMAIN)) > 0);
    });
  });
});
