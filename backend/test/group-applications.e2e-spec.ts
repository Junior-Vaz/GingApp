import { INestApplication } from '@nestjs/common';
import { GroupApplicationStatus, OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
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
 * Tudo que o spec cria usa o dominio @e2e-adesao.local / nome "E2E Adesao <stamp>" e e apagado no after().
 * Com ADESAO_CAPTURE_DIR definido grava o JSON REAL: adesao-real-public.json (POST 201 + GET em PENDING/APPROVED/REJECTED)
 * e adesao-real-admin.json (lista do admin com itens de cada status) para virar fixture do painel/admin.
 */
const DOMAIN = 'e2e-adesao.local';
const TEAM_TAG = 'adesao';

describe('Adesão de grupos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const mail = new MemoryMailTransport();
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
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const pubPost = (body: object) => rec(http().post('/api/public/group-applications').send(body));
  const pubGet = (token: string) => rec(http().get(`/api/public/group-applications/${token}`));
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
  /** Cria um pedido pelo endpoint publico e devolve token + linha do banco. */
  const submit = async (over: Record<string, unknown> = {}) => {
    const b = body(over);
    const res = await pubPost(b);
    assert.equal(res.status, 201, res.text);
    const row = await prisma.groupApplication.findUnique({ where: { statusTokenHash: sha256(res.body.statusToken) } });
    assert.ok(row, 'pedido gravado');
    return { token: res.body.statusToken as string, row, body: b };
  };

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
    await app.close();
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

  const PUBLIC_KEYS = ['createdAt', 'decidedAt', 'groupName', 'loginUrl', 'rejectionReason', 'status'];
  const ADMIN_KEYS = [
    'applicantName', 'city', 'claimedRole', 'claimedRoleLabel', 'createdAt', 'decidedAt', 'decidedBy', 'email', 'estimatedStudents',
    'groupName', 'id', 'internalNote', 'message', 'organization', 'phone', 'rejectionReason', 'state', 'status',
  ];

  describe('pedido público', () => {
    it('válido: 201 { statusToken, status }; só o hash bcrypt da senha e o sha256 do token no banco; nada de IP/UA; sem e-mail', async () => {
      const sentBefore = mail.sent.length;
      const b = body({ email: `  Maiusculas-${stamp}@${DOMAIN.toUpperCase()} `, state: 'go', applicantName: '  Fulana  ' });
      const res = await pubPost(b);
      assert.equal(res.status, 201, res.text);
      assert.deepEqual(Object.keys(res.body).sort(), ['status', 'statusToken']);
      assert.equal(res.body.status, 'PENDING');
      assert.match(res.body.statusToken, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(res.headers['cache-control'], 'no-store');
      captures.post201 = res.body;

      const row = await prisma.groupApplication.findUnique({ where: { statusTokenHash: sha256(res.body.statusToken) } });
      assert.ok(row);
      assert.equal(row.status, 'PENDING');
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
      assert.equal(mail.sent.length, sentBefore, 'nenhum e-mail no ato do pedido');
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

    it('honeypot preenchido: o MESMO 201, nada gravado, token não corresponde a nada (404)', async () => {
      const before = await countApps();
      const res = await pubPost(body({ website: 'http://spam.example' }));
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.body).sort(), ['status', 'statusToken']);
      assert.match(res.body.statusToken, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(await countApps(), before);
      assert.equal((await pubGet(res.body.statusToken)).status, 404);
    });

    it('e-mail com conta, com pedido pendente ou acima de 3 em 30 dias: MESMA resposta 201, nada criado, status 404', async () => {
      const shape = (r: { status: number; body: Record<string, unknown>; headers: Record<string, unknown> }) => ({
        status: r.status,
        keys: Object.keys(r.body).sort(),
        tokenLength: String(r.body.statusToken).length,
        bodyStatus: r.body.status,
        cache: r.headers['cache-control'],
        type: r.headers['content-type'],
      });
      const fresh = await pubPost(body());
      const reference = shape(fresh);

      // 1) e-mail que JA tem conta (outra caixa)
      const before = await countApps();
      const existing = await pubPost(body({ email: memberEmail.toUpperCase() }));
      assert.deepEqual(shape(existing), reference);
      assert.equal(await countApps(), before);
      assert.equal(await prisma.groupApplication.count({ where: { email: memberEmail } }), 0);
      assert.equal((await pubGet(existing.body.statusToken)).status, 404);

      // 2) e-mail com pedido PENDENTE
      const { body: pendingBody } = await submit();
      const dup = await pubPost(body({ email: (pendingBody.email as string).toUpperCase(), groupName: `${NAME} duplicado` }));
      assert.deepEqual(shape(dup), reference);
      assert.equal(await prisma.groupApplication.count({ where: { email: pendingBody.email as string } }), 1);
      assert.equal((await pubGet(dup.body.statusToken)).status, 404);

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

    it('dois pedidos simultâneos com o mesmo e-mail: os dois 201, só UM gravado (índice único parcial)', async () => {
      const same = email('corrida');
      const results = await Promise.all([pubPost(body({ email: same })), pubPost(body({ email: same }))]);
      assert.deepEqual(results.map((r) => r.status), [201, 201]);
      assert.equal(await prisma.groupApplication.count({ where: { email: same, status: 'PENDING' } }), 1);
    });
  });

  describe('acompanhamento por token', () => {
    it('PENDING: só as 6 chaves do contrato, sem Authorization, no-store; 404 uniforme para mal formado/inexistente', async () => {
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
      captures.statusPending = res.body;

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

  describe('banco, retenção e throttle', () => {
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
      assert.deepEqual(await job.run({ onlyIds }), { dryRun: true, expired: 1, deleted: 3, hashesCleared: 0 });
      assert.equal(await prisma.groupApplication.count({ where: { id: { in: onlyIds } } }), 7, 'dry-run não apaga');
      assert.equal((await prisma.groupApplication.findUniqueOrThrow({ where: { id: rows.pendingOld.id } })).status, 'PENDING');

      process.env.GROUP_APPLICATIONS_PURGE = 'true';
      try {
        assert.deepEqual(await job.run({ onlyIds, now }), { dryRun: false, expired: 1, deleted: 3, hashesCleared: 0 });
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
  });

  describe('captura e varredura final', () => {
    it('lista do admin com itens de cada status (captura com ADESAO_CAPTURE_DIR)', async () => {
      // o EXPIRED vem do teste de retencao acima (PENDING de 61 dias expirado pelo job)
      const res = await as(commonToken).get(`/platform-group-applications?q=${encodeURIComponent(DOMAIN)}&limit=200`);
      assert.equal(res.status, 200);
      const seen = new Set(res.body.map((i: { status: string }) => i.status));
      for (const s of ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']) assert.ok(seen.has(s), `lista sem ${s}`);
      // uma amostra de cada status (o JSON e REAL, so recortado)
      // preferindo os pedidos feitos pelo endpoint publico e decididos pela API (o EXPIRED so existe pelo job de retencao)
      type Item = { status: string; applicantName: string; decidedBy: unknown };
      const viaApi = (i: Item) => i.applicantName === 'Fulana Solicitante' && (i.status === 'PENDING' || i.status === 'EXPIRED' || i.decidedBy !== null);
      const sample = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].map(
        (s) => res.body.find((i: Item) => i.status === s && viaApi(i)) ?? res.body.find((i: Item) => i.status === s),
      );
      for (const required of ['post201', 'statusPending', 'statusApproved', 'statusRejected']) assert.ok(captures[required], `captura ${required}`);
      const dir = process.env.ADESAO_CAPTURE_DIR;
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, 'adesao-real-public.json'),
          `${JSON.stringify({ post201: captures.post201, statusPending: captures.statusPending, statusApproved: captures.statusApproved, statusRejected: captures.statusRejected }, null, 2)}\n`,
          'utf8',
        );
        await fs.writeFile(
          path.join(dir, 'adesao-real-admin.json'),
          `${JSON.stringify({ headers: { 'x-total-count': res.headers['x-total-count'] }, list: sample }, null, 2)}\n`,
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
      assert.ok(publicLines.every((l) => l.route === '/api/public/group-applications' || l.route === '/api/public/group-applications/:token'));
      assert.ok(requestLines.some((l) => String(l.route).startsWith('/api/platform-group-applications') && l.userId !== null), 'plataforma segue com userId');
      assert.ok(!logs.includes(SENTINEL), 'sentinela no log');
      assert.ok(!/\$2[aby]\$10\$/.test(logs), 'hash bcrypt no log');
      assert.ok(!logs.includes(String(captures.post201 && (captures.post201 as { statusToken: string }).statusToken)), 'token em claro no log');

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
