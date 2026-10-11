import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { OrganizationsController } from '../src/interface/http/organizations/organizations.controller';
import { createTestApp } from './utils/test-app';
import { createMemberSuperAdmin, createPlatformUser, memberLogin, platformLogin } from './utils/platform-team-fixtures';

/**
 * POST /organizations — o admin da plataforma cria um GRUPO (Organization type GROUP) + o seu MESTRE
 * numa única transação. Exclusivo de super admin ATIVO (SuperAdminGuard). Prova, com Prisma como
 * segunda via independente: o que foi gravado, que o MESTRE criado loga e opera (dashboard, aluno,
 * turma), isolamento entre grupos, atomicidade (corrida de e-mail => nenhuma organização órfã),
 * slug em colisão, política de senha 12..72 bytes sem Dev@12345, 401/403 por tipo de ator, resposta
 * sem segredo e rate limit.
 *
 * Tudo que a suíte cria é apagado no after() (por id rastreado + varredura por prefixo/domínio).
 */
const TAG = `${Date.now()}`;
const NAME_PREFIX = 'E2E OrgCreate';
const MAIL_DOMAIN = 'e2e-org-create.local';
const SLUG_PREFIX = 'e2e-orgcreate-';
const GOOD_PASSWORD = 'Mestre#Seguro2026';
const DEV_PASSWORD = 'Dev@12345';
const SEED_MESTRE = 'mestre@gingabrasil.com.br';
const SEED_ALUNO = 'aluno@gingabrasil.com.br';

let seq = 0;
const uniq = () => `${TAG}-${++seq}`;

function body(
  overrides: Record<string, unknown> = {},
  mestre: Record<string, unknown> = {},
): Record<string, unknown> {
  const n = uniq();
  return {
    name: `${NAME_PREFIX} ${n}`,
    mestre: { name: `Mestre ${n}`, email: `mestre-${n}@${MAIL_DOMAIN}`, password: GOOD_PASSWORD, ...mestre },
    ...overrides,
  };
}

describe('POST /organizations — criar grupo + MESTRE (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();

  let superToken: string;
  const fixtureUserIds: number[] = [];
  const fixtureCleanups: Array<() => Promise<void>> = [];
  let plainPlatformToken: string;
  let memberSuperToken: string;
  let seedMestreToken: string;
  let seedAlunoToken: string;
  let seedOrgId: number;
  let seedStudentId: number;

  const createdOrgIds: number[] = [];

  const post = (token: string | undefined, payload: unknown) => {
    const req = request(server()).post('/api/organizations');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(payload as object);
  };

  /** 201 esperado: rastreia a organização para o cleanup. */
  async function create(payload: Record<string, unknown>) {
    const res = await post(superToken, payload);
    if (res.body?.id) createdOrgIds.push(res.body.id);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  }

  /** Nada com este nome/e-mail pode existir (recusa => zero efeito colateral). */
  async function assertNothingCreated(name: string, email: string) {
    assert.equal(await prisma.organization.count({ where: { name } }), 0, `organização "${name}" não deveria existir`);
    assert.equal(
      await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } }),
      0,
      `usuário ${email} não deveria existir`,
    );
  }

  async function memberToken(email: string, password = GOOD_PASSWORD) {
    const res = await request(server()).post('/api/auth/login').send({ email, password }).expect(200);
    return res.body as { accessToken: string; user: { organizationId: number; role: string } };
  }

  before(async () => {
    app = await createTestApp();

    const superAdmin = await createPlatformUser(prisma, 'orgcreate-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, 'orgcreate-plain', { isSuperAdmin: false });
    fixtureUserIds.push(superAdmin.id, plain.id);
    superToken = await platformLogin(app, superAdmin.email);
    plainPlatformToken = await platformLogin(app, plain.email);

    const memberSuper = await createMemberSuperAdmin(prisma, 'orgcreate');
    fixtureCleanups.push(memberSuper.cleanup);
    memberSuperToken = await memberLogin(app, memberSuper.email);

    const mestre = await memberToken(SEED_MESTRE, DEV_PASSWORD);
    seedMestreToken = mestre.accessToken;
    seedOrgId = mestre.user.organizationId;
    seedAlunoToken = (await memberToken(SEED_ALUNO, DEV_PASSWORD)).accessToken;
    seedStudentId = (await prisma.student.findFirstOrThrow({ where: { organizationId: seedOrgId } })).id;
  });

  after(async () => {
    // Organizações da suíte: as rastreadas + qualquer uma com o prefixo de nome/slug (cobre órfãs de
    // uma falha de atomicidade). Os usuários criados são os do domínio da suíte + os MESTREs rastreados.
    const swept = await prisma.organization.findMany({
      where: {
        OR: [
          { id: { in: createdOrgIds } },
          { name: { startsWith: NAME_PREFIX } },
          { slug: { startsWith: SLUG_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const orgIds = swept.map((o) => o.id);
    const memberships = await prisma.organizationUser.findMany({
      where: { organizationId: { in: orgIds } },
      select: { userId: true },
    });
    const userIds = [
      ...new Set([
        ...memberships.map((m) => m.userId),
        ...(await prisma.user.findMany({ where: { email: { endsWith: `@${MAIL_DOMAIN}` } }, select: { id: true } })).map(
          (u) => u.id,
        ),
      ]),
    ];

    await prisma.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.classStudent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.class.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.subscription.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

    for (const cleanup of fixtureCleanups) await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('autorização', () => {
    it('sem token => 401 e nada criado', async () => {
      const payload = body();
      await post(undefined, payload).expect(401);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });

    it('MEMBER (inclusive MESTRE e ALUNO) => 403 e nada criado', async () => {
      for (const token of [seedMestreToken, seedAlunoToken]) {
        const payload = body();
        const res = await post(token, payload).expect(403);
        assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
        await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
      }
    });

    it('MESTRE de um grupo recém-criado também leva 403 (não vira admin)', async () => {
      const created = await create(body());
      const mestre = await memberToken(created.mestre.email);
      const payload = body();
      await post(mestre.accessToken, payload).expect(403);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });

    it('MEMBER com isSuperAdmin=true => 403 (só PLATFORM conta)', async () => {
      const payload = body();
      await post(memberSuperToken, payload).expect(403);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });

    it('PLATFORM que não é super admin => 403 e nada criado', async () => {
      const payload = body();
      await post(plainPlatformToken, payload).expect(403);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });

    it('403 vem antes da validação do corpo (corpo inválido + sem permissão => 403, não 400)', async () => {
      await post(plainPlatformToken, {}).expect(403);
      await post(seedMestreToken, { qualquer: 'coisa' }).expect(403);
    });

    it('super admin rebaixado/desativado depois do login perde o acesso na hora', async () => {
      const temp = await createPlatformUser(prisma, 'orgcreate-temp', { isSuperAdmin: true });
      fixtureUserIds.push(temp.id);
      const token = await platformLogin(app, temp.email);

      await prisma.user.update({ where: { id: temp.id }, data: { isSuperAdmin: false } });
      let payload = body();
      await post(token, payload).expect(403);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);

      await prisma.user.update({ where: { id: temp.id }, data: { isSuperAdmin: true, status: 'INACTIVE' } });
      payload = body();
      await post(token, payload).expect(401);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });
  });

  describe('criação feliz', () => {
    it('201: grava Organization GROUP/ACTIVE + User MEMBER + OrganizationUser MESTRE, confirmado via Prisma', async () => {
      const n = uniq();
      const email = `Mestre.Misto-${n}@${MAIL_DOMAIN}`;
      const res = await post(superToken, {
        name: `  ${NAME_PREFIX} Ação São João ${n}  `,
        document: '12.345.678/0001-95',
        email: `Contato-${n}@${MAIL_DOMAIN}`,
        phone: '+55 (11) 91234-5678',
        mestre: { name: ` Mestre Ângelo ${n} `, email: ` ${email} `, password: GOOD_PASSWORD },
      });
      if (res.body?.id) createdOrgIds.push(res.body.id);
      assert.equal(res.status, 201, JSON.stringify(res.body));

      const org = await prisma.organization.findUniqueOrThrow({ where: { id: res.body.id } });
      assert.equal(org.type, 'GROUP');
      assert.equal(org.status, 'ACTIVE');
      assert.equal(org.name, `${NAME_PREFIX} Ação São João ${n}`);
      assert.equal(org.slug, `e2e-orgcreate-acao-sao-joao-${n}`);
      assert.equal(org.document, '12.345.678/0001-95');
      assert.equal(org.email, `contato-${n}@${MAIL_DOMAIN}`);
      assert.equal(org.phone, '+55 (11) 91234-5678');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.mestre.id } });
      assert.equal(user.email, email.toLowerCase());
      assert.equal(user.userType, 'MEMBER');
      assert.equal(user.isSuperAdmin, false);
      assert.equal(user.status, 'ACTIVE');
      assert.equal(user.name, `Mestre Ângelo ${n}`);
      assert.ok(user.passwordHash.startsWith('$2b$10$'), 'bcrypt com custo 10 (mesmo do restante do código)');
      assert.ok(await bcrypt.compare(GOOD_PASSWORD, user.passwordHash));

      const memberships = await prisma.organizationUser.findMany({ where: { organizationId: org.id } });
      assert.equal(memberships.length, 1);
      assert.equal(memberships[0].userId, user.id);
      assert.equal(memberships[0].role, 'MESTRE');
      assert.equal(memberships[0].status, 'ACTIVE');

      // Nada além do estritamente necessário: sem assinatura; só a unidade MATRIZ (E02) nasce com o grupo.
      assert.equal(await prisma.subscription.count({ where: { organizationId: org.id } }), 0);
      const units = await prisma.unit.findMany({ where: { organizationId: org.id } });
      assert.equal(units.length, 1);
      assert.equal(units[0].name, 'Matriz');
      assert.equal(units[0].isMain, true);
      assert.equal(units[0].status, 'ACTIVE');
    });

    it('resposta = organização (mesmas colunas do GET /organizations) + mestre {id,name,email}, sem segredo', async () => {
      const payload = body();
      const password = (payload.mestre as { password: string }).password;
      const created = await create(payload);

      assert.deepEqual(Object.keys(created.mestre).sort(), ['email', 'id', 'name']);
      const text = JSON.stringify(created);
      for (const forbidden of ['passwordHash', 'password', password, '$2b$', 'twoFactorSecret', 'tokenValidAfter']) {
        assert.ok(!text.includes(forbidden), `resposta não pode conter ${forbidden}`);
      }

      const list = await request(server()).get('/api/organizations').set('Authorization', `Bearer ${superToken}`).expect(200);
      const listed = list.body.find((o: { id: number }) => o.id === created.id);
      assert.ok(listed, 'GET /organizations (admin) lista o grupo recém-criado');
      const { mestre: _mestre, ...orgPart } = created;
      assert.deepEqual(listed, orgPart);
    });

    it('o MESTRE criado FAZ LOGIN, acessa o dashboard, cria aluno e turma (sem plano nem unidade)', async () => {
      const payload = body();
      const created = await create(payload);
      const email = (payload.mestre as { email: string }).email;

      const login = await memberToken(email);
      assert.equal(login.user.organizationId, created.id);
      assert.equal(login.user.role, 'MESTRE');
      const auth = { Authorization: `Bearer ${login.accessToken}` };

      const dash = await request(server()).get('/api/dashboard').set(auth).expect(200);
      assert.equal(dash.body.students.active, 0);
      assert.ok(dash.body.finance, 'MESTRE enxerga o bloco financeiro (matriz RolePermission aplicada)');

      const student = await request(server()).post('/api/students').set(auth).send({ name: 'Aluno do Grupo Novo' }).expect(201);
      assert.equal(student.body.organizationId, created.id);
      await request(server()).post('/api/classes').set(auth).send({ name: 'Turma Inicial' }).expect(201);

      const students = await request(server()).get('/api/students').set(auth).expect(200);
      assert.equal(students.body.length, 1);
      assert.equal(students.headers['x-total-count'], '1');

      const dashAfter = await request(server()).get('/api/dashboard').set(auth).expect(200);
      assert.equal(dashAfter.body.students.active, 1);
      assert.equal(dashAfter.body.classes.active, 1);

      // Sem assinatura: /subscriptions/me responde 200 (vazio), não quebra.
      await request(server()).get('/api/subscriptions/me').set(auth).expect(200);
      // Vê só a própria organização.
      const own = await request(server()).get('/api/organizations').set(auth).expect(200);
      assert.equal(own.body.id, created.id);
    });

    it('login do MESTRE com senha errada => 401', async () => {
      const payload = body();
      await create(payload);
      await request(server())
        .post('/api/auth/login')
        .send({ email: (payload.mestre as { email: string }).email, password: GOOD_PASSWORD + 'x' })
        .expect(401);
    });

    it('isolamento: o novo grupo não vê dados de outro (lista, id direto, mutação)', async () => {
      const a = await create(body());
      const b = await create(body());
      const aAuth = { Authorization: `Bearer ${(await memberToken(a.mestre.email)).accessToken}` };
      const bAuth = { Authorization: `Bearer ${(await memberToken(b.mestre.email)).accessToken}` };

      const aStudent = await request(server()).post('/api/students').set(aAuth).send({ name: 'Aluno do A' }).expect(201);

      const bList = await request(server()).get('/api/students').set(bAuth).expect(200);
      assert.equal(bList.body.length, 0);
      const bDash = await request(server()).get('/api/dashboard').set(bAuth).expect(200);
      assert.equal(bDash.body.students.active, 0);
      await request(server()).get(`/api/students/${aStudent.body.id}`).set(bAuth).expect(404);
      await request(server()).patch(`/api/students/${aStudent.body.id}`).set(bAuth).send({ name: 'Nome Novo' }).expect(404);
      await request(server()).delete(`/api/students/${aStudent.body.id}`).set(bAuth).expect(404);
      // ...nem o do grupo do seed
      await request(server()).get(`/api/students/${seedStudentId}`).set(bAuth).expect(404);

      const aList = await request(server()).get('/api/students').set(aAuth).expect(200);
      assert.deepEqual(
        aList.body.map((s: { id: number }) => s.id),
        [aStudent.body.id],
      );
      const bOrgs = await request(server()).get('/api/organizations').set(bAuth).expect(200);
      assert.equal(bOrgs.body.id, b.id);
      assert.notEqual(b.id, a.id);
    });
  });

  describe('e-mail do MESTRE (único globalmente) e atomicidade', () => {
    it('e-mail já usado (mesmo em caixa diferente) => 409 com mensagem clara, sem criar nada', async () => {
      const first = body();
      await create(first);
      const email = (first.mestre as { email: string }).email;
      const orgsBefore = await prisma.organization.count();
      const usersBefore = await prisma.user.count();

      const second = body({}, { email: email.toUpperCase() });
      const res = await post(superToken, second).expect(409);
      assert.match(res.body.message, /e-mail/i);

      assert.equal(await prisma.organization.count(), orgsBefore, 'nenhuma organização órfã');
      assert.equal(await prisma.user.count(), usersBefore);
      assert.equal(await prisma.organization.count({ where: { name: second.name as string } }), 0);
    });

    it('e-mail de usuário do seed e da equipe PLATFORM => 409', async () => {
      for (const email of [SEED_MESTRE, 'owner@gingapp.com.br']) {
        const payload = body({}, { email });
        const orgsBefore = await prisma.organization.count();
        await post(superToken, payload).expect(409);
        assert.equal(await prisma.organization.count(), orgsBefore);
        assert.equal(await prisma.organization.count({ where: { name: payload.name as string } }), 0);
      }
    });

    it('corrida: duas criações simultâneas com o MESTRE de mesmo e-mail => 1x201 + 1x409 e NENHUMA organização órfã (transação)', async () => {
      for (let round = 0; round < 4; round++) {
        const email = `corrida-${uniq()}@${MAIL_DOMAIN}`;
        const p1 = body({}, { email });
        const p2 = body({}, { email });
        const [r1, r2] = await Promise.all([post(superToken, p1), post(superToken, p2)]);
        for (const r of [r1, r2]) if (r.body?.id) createdOrgIds.push(r.body.id);

        const statuses = [r1.status, r2.status].sort();
        assert.deepEqual(statuses, [201, 409], `rodada ${round}: ${statuses}`);
        const winner = r1.status === 201 ? p1 : p2;
        const loser = r1.status === 201 ? p2 : p1;
        const loserRes = r1.status === 201 ? r2 : r1;
        assert.match(loserRes.body.message, /e-mail/i);

        assert.equal(await prisma.organization.count({ where: { name: winner.name as string } }), 1);
        assert.equal(
          await prisma.organization.count({ where: { name: loser.name as string } }),
          0,
          'a organização do perdedor foi desfeita (sem órfã)',
        );
        assert.equal(await prisma.user.count({ where: { email } }), 1);
        assert.equal(await prisma.organizationUser.count({ where: { user: { email } } }), 1);
      }
    });

    it('slug explícito em uso => 409 e o MESTRE não é criado', async () => {
      const taken = `${SLUG_PREFIX}${uniq()}`;
      await create(body({ slug: taken }));

      const payload = body({ slug: taken });
      const res = await post(superToken, payload).expect(409);
      assert.match(res.body.message, /slug/i);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });
  });

  describe('slug', () => {
    it('gerado do nome: kebab-case sem acento/símbolos; colisões ganham sufixo numérico', async () => {
      const n = uniq();
      const base = `Capoeira Ângela & Filhos!! ${n}`;
      const expected = `capoeira-angela-filhos-${n}`;
      const first = await create(body({ name: base }));
      assert.equal(first.slug, expected);
      const second = await create(body({ name: base }));
      assert.equal(second.slug, `${expected}-2`);
      const third = await create(body({ name: base.toUpperCase() }));
      assert.equal(third.slug, `${expected}-3`);

      const persisted = await prisma.organization.findMany({ where: { id: { in: [first.id, second.id, third.id] } } });
      assert.equal(new Set(persisted.map((o) => o.slug)).size, 3);
    });

    it('colide com o grupo do seed (ginga-brasil) => ginga-brasil-N', async () => {
      const created = await create(body({ name: 'Ginga Brasil' }));
      assert.match(created.slug, /^ginga-brasil-\d+$/);
    });

    it('nome só de símbolos cai no slug base "grupo"', async () => {
      const created = await create(body({ name: '!!' }));
      assert.match(created.slug, /^grupo(-\d+)?$/);
    });

    it('slug explícito é usado como informado', async () => {
      const slug = `${SLUG_PREFIX}explicito-${uniq()}`;
      const created = await create(body({ slug }));
      assert.equal(created.slug, slug);
    });

    it('slug explícito inválido => 400 e nada criado', async () => {
      for (const slug of ['Grupo Ginga', 'grupo_ginga', 'Grupo-Ginga', 'grupo--ginga', '-grupo', 'grupo-', 'ação', 'a', 'x'.repeat(61)]) {
        const payload = body({ slug });
        await post(superToken, payload).expect(400);
        await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
      }
    });
  });

  describe('senha inicial do MESTRE (12..72, sem Dev@12345)', () => {
    async function rejected(password: string, expectMessage: RegExp) {
      const payload = body({}, { password });
      const res = await post(superToken, payload).expect(400);
      assert.match(JSON.stringify(res.body.message), expectMessage);
      assert.ok(!JSON.stringify(res.body).includes(password), 'a senha não volta na mensagem');
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    }

    it('curta (11) => 400 e nada criado', () => rejected('Abcdef#12345'.slice(0, 11), /12 caracteres/));
    it('Dev@12345 => 400 e nada criado', () => rejected(DEV_PASSWORD, /mestre\.password/));
    it('senha de dev embutida em uma senha longa (Dev@12345!!!) => 400 pela lista de senhas proibidas', () =>
      rejected('Dev@12345!!!', /padrão de desenvolvimento/));
    it('73 caracteres => 400 e nada criado', () => rejected('a'.repeat(73), /no máximo 72/));
    it('37 caracteres de 2 bytes (74 bytes UTF-8) => 400: o limite do bcrypt é em bytes', () =>
      rejected('ç'.repeat(37), /no máximo 72/));
    it('não-string => 400', async () => {
      const payload = body({}, { password: 123456789012 });
      await post(superToken, payload).expect(400);
      await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
    });

    it('exatamente 12 e exatamente 72 são aceitas, e o MESTRE entra com elas', async () => {
      for (const password of ['Abcdefgh#123', 'A#' + 'b'.repeat(70), 'ç'.repeat(36)]) {
        const payload = body({}, { password });
        await create(payload);
        const login = await memberToken((payload.mestre as { email: string }).email, password);
        assert.ok(login.accessToken);
      }
    });
  });

  describe('validação do corpo (whitelist + forbidNonWhitelisted)', () => {
    it('rejeita corpo incompleto/inválido/extra com 400 e nada criado', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        ['sem mestre', { name: `${NAME_PREFIX} sem-mestre ${uniq()}` }],
        ['mestre não-objeto', body({ mestre: 'x' })],
        ['sem nome', (() => { const b = body(); delete b.name; return b; })()],
        ['nome curto', body({ name: 'A' })],
        ['nome longo', body({ name: 'A'.repeat(121) })],
        ['campo desconhecido (type=SYSTEM)', body({ type: 'SYSTEM' })],
        ['campo desconhecido (status)', body({ status: 'INACTIVE' })],
        ['campo desconhecido (id)', body({ id: 1 })],
        ['mestre com isSuperAdmin', body({}, { isSuperAdmin: true })],
        ['mestre com userType', body({}, { userType: 'PLATFORM' })],
        ['mestre com role', body({}, { role: 'PROFESSOR' })],
        ['e-mail do mestre inválido', body({}, { email: 'sem-arroba' })],
        ['mestre sem nome', body({}, { name: '' })],
        ['mestre sem senha', body({}, { password: undefined })],
        ['e-mail da organização inválido', body({ email: 'x@' })],
        ['documento inválido', body({ document: '123' })],
        ['documento com letras', body({ document: 'ABCDEFGHIJK' })],
        ['telefone inválido', body({ phone: 'abc' })],
        ['telefone vazio', body({ phone: '' })],
      ];
      for (const [label, payload] of cases) {
        const orgsBefore = await prisma.organization.count();
        const usersBefore = await prisma.user.count();
        const res = await post(superToken, payload);
        assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status} ${JSON.stringify(res.body)}`);
        assert.equal(await prisma.organization.count(), orgsBefore, label);
        assert.equal(await prisma.user.count(), usersBefore, label);
      }
    });

    it('CPF e CNPJ (com e sem pontuação) são aceitos', async () => {
      for (const document of ['12345678901', '123.456.789-01', '12345678000195', '12.345.678/0001-95']) {
        const created = await create(body({ document }));
        assert.equal(created.document, document);
      }
    });

    it('campos opcionais ausentes ficam NULL', async () => {
      const created = await create(body());
      assert.equal(created.document, null);
      assert.equal(created.email, null);
      assert.equal(created.phone, null);
    });
  });

  describe('pré-condição: matriz de permissões', () => {
    it('sem RolePermission do MESTRE => 503 claro e nada criado (restaurada em seguida)', async () => {
      const saved = await prisma.rolePermission.findMany({ where: { role: 'MESTRE' } });
      assert.ok(saved.length > 0, 'o seed carrega a matriz do MESTRE');
      try {
        await prisma.rolePermission.deleteMany({ where: { role: 'MESTRE' } });
        const payload = body();
        const res = await post(superToken, payload).expect(503);
        assert.match(res.body.message, /RolePermission|permiss/i);
        await assertNothingCreated(payload.name as string, (payload.mestre as { email: string }).email);
      } finally {
        await prisma.rolePermission.deleteMany({ where: { role: 'MESTRE' } });
        await prisma.rolePermission.createMany({ data: saved });
      }
      assert.equal(await prisma.rolePermission.count({ where: { role: 'MESTRE' } }), saved.length);
      await create(body()); // volta a funcionar
    });
  });

  describe('rate limit', () => {
    it('a rota declara limite próprio e o guard aplica (429 depois do limite)', async () => {
      const handler = OrganizationsController.prototype.create;
      const key = 'THROTTLER:LIMITdefault';
      const original = Reflect.getMetadata(key, handler);
      assert.equal(typeof original, 'number', 'POST /organizations declara @Throttle próprio');
      assert.ok(original > 0);

      // App novo (contador de throttle limpo) com o limite rebaixado para 3 só nesta prova.
      Throttle({ default: { limit: 3, ttl: 60_000 } })(
        OrganizationsController.prototype,
        'create',
        Object.getOwnPropertyDescriptor(OrganizationsController.prototype, 'create')!,
      );
      const limited = await createTestApp();
      try {
        const attempt = () =>
          request(limited.getHttpServer())
            .post('/api/organizations')
            .set('Authorization', `Bearer ${superToken}`)
            .send({});
        for (let i = 0; i < 3; i++) await attempt().expect(400);
        await attempt().expect(429);
      } finally {
        await limited.close();
        Throttle({ default: { limit: original, ttl: 60_000 } })(
          OrganizationsController.prototype,
          'create',
          Object.getOwnPropertyDescriptor(OrganizationsController.prototype, 'create')!,
        );
      }
      assert.equal(Reflect.getMetadata(key, handler), original);
    });
  });

  it('o grupo do seed continua intacto e fora do alcance dos grupos criados', async () => {
    assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: seedOrgId } })).slug, 'ginga-brasil');
    assert.equal(await prisma.organizationUser.count({ where: { organizationId: seedOrgId, user: { email: { endsWith: `@${MAIL_DOMAIN}` } } } }), 0);
  });
});
