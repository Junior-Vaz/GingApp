import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { createMemberSuperAdmin, createPlatformUser, memberLogin, platformLogin } from './utils/platform-team-fixtures';

/**
 * PATCH /organizations/:id, POST /organizations/:id/deactivate|reactivate e GET /subscriptions?organizationId=.
 * Só super admin ATIVO edita/desativa. Desativar NUNCA apaga dados (provado por Prisma, 2ª via) e
 * derruba login + tokens já emitidos dos usuários do grupo (JwtStrategy), sem afetar outros grupos
 * nem a equipe PLATFORM; reativar restaura. Tudo que a suíte cria é removido no after().
 */
const TAG = `${Date.now()}`;
const MAIL_DOMAIN = 'e2e-org-manage.local';
const SLUG_PREFIX = 'e2e-orgmanage-';
const PASSWORD = 'Mestre#Seguro2026';

describe('Organizations: editar, desativar/reativar e filtrar assinaturas (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();

  let superToken: string;
  let plainToken: string;
  let memberSuperToken: string;
  const fixtureUserIds: number[] = [];
  const fixtureCleanups: Array<() => Promise<void>> = [];
  const orgIds: number[] = [];
  const planIds: number[] = [];

  let orgA: { id: number; slug: string; mestreEmail: string; mestreId: number };
  let orgB: { id: number; slug: string; mestreEmail: string; mestreId: number };

  async function makeGroup(label: string) {
    const org = await prisma.organization.create({
      data: {
        name: `E2E OrgManage ${label} ${TAG}`,
        slug: `${SLUG_PREFIX}${label}-${TAG}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
        document: '12345678901',
        email: `grupo-${label}@${MAIL_DOMAIN}`,
        phone: '11999990000',
      },
    });
    orgIds.push(org.id);
    const email = `mestre-${label}-${TAG}@${MAIL_DOMAIN}`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(PASSWORD, 4), name: `Mestre ${label}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({
      data: { organizationId: org.id, userId: user.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });
    await prisma.student.create({ data: { organizationId: org.id, name: `Aluno ${label}` } });
    return { id: org.id, slug: org.slug, mestreEmail: email, mestreId: user.id };
  }

  const login = (email: string) => request(server()).post('/api/auth/login').send({ email, password: PASSWORD });
  const patch = (id: number | string, token: string | undefined, payload: unknown) => {
    const req = request(server()).patch(`/api/organizations/${id}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(payload as object);
  };
  const act = (id: number | string, what: 'deactivate' | 'reactivate', token: string | undefined) => {
    const req = request(server()).post(`/api/organizations/${id}/${what}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };
  const dbOrg = (id: number) => prisma.organization.findUniqueOrThrow({ where: { id } });

  before(async () => {
    app = await createTestApp();
    const superAdmin = await createPlatformUser(prisma, 'orgmanage-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, 'orgmanage-plain', { isSuperAdmin: false });
    fixtureUserIds.push(superAdmin.id, plain.id);
    superToken = await platformLogin(app, superAdmin.email);
    plainToken = await platformLogin(app, plain.email);
    const memberSuper = await createMemberSuperAdmin(prisma, 'orgmanage');
    fixtureCleanups.push(memberSuper.cleanup);
    memberSuperToken = await memberLogin(app, memberSuper.email);

    orgA = await makeGroup('a');
    orgB = await makeGroup('b');
  });

  after(async () => {
    const memberships = await prisma.organizationUser.findMany({
      where: { organizationId: { in: orgIds } },
      select: { userId: true },
    });
    const userIds = memberships.map((m) => m.userId);
    await prisma.subscription.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    for (const cleanup of fixtureCleanups) await cleanup();
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('autorização', () => {
    it('sem token => 401; PLATFORM comum, MEMBER (MESTRE) e MEMBER com isSuperAdmin => 403, sem alterar nada', async () => {
      const mestreToken = (await login(orgA.mestreEmail).expect(200)).body.accessToken as string;
      const before = await dbOrg(orgA.id);
      await patch(orgA.id, undefined, { name: 'X Nome' }).expect(401);
      await act(orgA.id, 'deactivate', undefined).expect(401);
      for (const token of [plainToken, mestreToken, memberSuperToken]) {
        await patch(orgA.id, token, { name: 'Hack Nome' }).expect(403);
        await act(orgA.id, 'deactivate', token).expect(403);
        await act(orgA.id, 'reactivate', token).expect(403);
      }
      assert.deepEqual(await dbOrg(orgA.id), before, 'nada mudou no banco');
    });

    it('403 vem antes da validação do corpo', async () => {
      await patch(orgA.id, plainToken, { slug: 'x' }).expect(403);
    });
  });

  describe('PATCH /organizations/:id', () => {
    it('edita name/document/email/phone (trim, e-mail em minúsculas), mantém slug e devolve a organização', async () => {
      const res = await patch(orgA.id, superToken, {
        name: '  E2E OrgManage Editado  ',
        document: ' 12.345.678/0001-95 ',
        email: '  Contato@Editado.COM.br ',
        phone: '+55 (11) 98888-7777',
      }).expect(200);
      assert.equal(res.body.name, 'E2E OrgManage Editado');
      assert.equal(res.body.email, 'contato@editado.com.br');
      assert.equal(res.body.slug, orgA.slug);
      const row = await dbOrg(orgA.id);
      assert.equal(row.name, 'E2E OrgManage Editado');
      assert.equal(row.document, '12.345.678/0001-95');
      assert.equal(row.email, 'contato@editado.com.br');
      assert.equal(row.phone, '+55 (11) 98888-7777');
      assert.equal(row.slug, orgA.slug);
      assert.equal(row.status, 'ACTIVE');
    });

    it('update parcial só altera o campo enviado; null limpa document/email/phone', async () => {
      await patch(orgA.id, superToken, { phone: null, document: null, email: null }).expect(200);
      const row = await dbOrg(orgA.id);
      assert.equal(row.phone, null);
      assert.equal(row.document, null);
      assert.equal(row.email, null);
      assert.equal(row.name, 'E2E OrgManage Editado', 'name intacto');
    });

    it('slug é imutável (400), status/type/id também não passam por aqui; nada muda', async () => {
      const before = await dbOrg(orgA.id);
      for (const extra of [{ slug: 'novo-slug' }, { status: 'INACTIVE' }, { type: 'PLATFORM' }, { id: 99 }]) {
        await patch(orgA.id, superToken, { name: 'Nome Valido', ...extra }).expect(400);
      }
      assert.deepEqual(await dbOrg(orgA.id), before);
    });

    it('validações iguais às do POST: name, document, email, phone, tipos errados e corpo vazio => 400', async () => {
      const before = await dbOrg(orgA.id);
      const bad: Array<Record<string, unknown>> = [
        {},
        { name: 'A' },
        { name: 'x'.repeat(121) },
        { name: null },
        { name: 123 },
        { document: '123' },
        { document: 'abc' },
        { email: 'nao-e-email' },
        { phone: '12' },
        { phone: 'telefone-ruim' },
      ];
      for (const payload of bad) {
        const res = await patch(orgA.id, superToken, payload);
        assert.equal(res.status, 400, `${JSON.stringify(payload)} => ${res.status} ${JSON.stringify(res.body)}`);
      }
      assert.deepEqual(await dbOrg(orgA.id), before, 'nenhuma rejeição altera o banco');
    });

    it('inexistente e id gigante => 404; id não numérico => 400', async () => {
      await patch(2_000_000_000, superToken, { name: 'Nome Valido' }).expect(404);
      await patch(99_999_999_999, superToken, { name: 'Nome Valido' }).expect(404);
      await patch('abc', superToken, { name: 'Nome Valido' }).expect(400);
    });
  });

  describe('desativar / reativar', () => {
    let mestreTokenB: string;
    let mestreTokenA: string;

    it('desativar: status INACTIVE, NENHUM dado apagado, outro grupo e a equipe PLATFORM intactos', async () => {
      mestreTokenA = (await login(orgA.mestreEmail).expect(200)).body.accessToken;
      mestreTokenB = (await login(orgB.mestreEmail).expect(200)).body.accessToken;
      await request(server()).get('/api/students').set('Authorization', `Bearer ${mestreTokenA}`).expect(200);

      const counts = async () => ({
        students: await prisma.student.count({ where: { organizationId: orgA.id } }),
        memberships: await prisma.organizationUser.count({ where: { organizationId: orgA.id } }),
        users: await prisma.user.count({ where: { id: orgA.mestreId } }),
      });
      const before = await counts();

      const res = await act(orgA.id, 'deactivate', superToken).expect(200);
      assert.equal(res.body.status, 'INACTIVE');
      assert.equal((await dbOrg(orgA.id)).status, 'INACTIVE');
      assert.deepEqual(await counts(), before, 'desativar não apaga nada');
      assert.equal((await dbOrg(orgB.id)).status, 'ACTIVE');

      // A equipe PLATFORM continua enxergando o grupo (e o status) e operando.
      const detail = await request(server())
        .get(`/api/organizations/${orgA.id}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
      assert.equal(detail.body.status, 'INACTIVE');
      await request(server()).get('/api/organizations').set('Authorization', `Bearer ${plainToken}`).expect(200);
    });

    it('usuário do grupo inativo: login => 401 genérico e o token já emitido => 401', async () => {
      const denied = await login(orgA.mestreEmail).expect(401);
      assert.equal(denied.body.message, 'Credenciais inválidas.');
      await request(server()).get('/api/students').set('Authorization', `Bearer ${mestreTokenA}`).expect(401);
      await request(server()).get('/api/organizations').set('Authorization', `Bearer ${mestreTokenA}`).expect(401);
    });

    it('outro grupo ativo continua logando e usando o token normalmente', async () => {
      await login(orgB.mestreEmail).expect(200);
      await request(server()).get('/api/students').set('Authorization', `Bearer ${mestreTokenB}`).expect(200);
    });

    it('usuário em dois grupos: com um inativo, loga automaticamente no ativo (sem exigir organizationSlug)', async () => {
      await prisma.organizationUser.create({
        data: { organizationId: orgB.id, userId: orgA.mestreId, role: OrgRole.PROFESSOR, status: 'ACTIVE' },
      });
      const res = await login(orgA.mestreEmail).expect(200);
      assert.equal(res.body.user.organizationId, orgB.id);
      await prisma.organizationUser.deleteMany({ where: { organizationId: orgB.id, userId: orgA.mestreId } });
    });

    it('desativar é idempotente (200 de novo) e editar um grupo inativo continua permitido ao super admin', async () => {
      const again = await act(orgA.id, 'deactivate', superToken).expect(200);
      assert.equal(again.body.status, 'INACTIVE');
      await patch(orgA.id, superToken, { name: 'E2E OrgManage Inativo Editado' }).expect(200);
      assert.equal((await dbOrg(orgA.id)).status, 'INACTIVE', 'editar não reativa');
    });

    it('reativar: status ACTIVE, o mestre volta a logar e usa o token novo; o token antigo continua válido (sem revogação)', async () => {
      const res = await act(orgA.id, 'reactivate', superToken).expect(200);
      assert.equal(res.body.status, 'ACTIVE');
      assert.equal((await dbOrg(orgA.id)).status, 'ACTIVE');
      const fresh = (await login(orgA.mestreEmail).expect(200)).body.accessToken;
      await request(server()).get('/api/students').set('Authorization', `Bearer ${fresh}`).expect(200);
      await request(server()).get('/api/students').set('Authorization', `Bearer ${mestreTokenA}`).expect(200);
      const again = await act(orgA.id, 'reactivate', superToken).expect(200);
      assert.equal(again.body.status, 'ACTIVE');
    });

    it('inexistente => 404', async () => {
      await act(2_000_000_000, 'deactivate', superToken).expect(404);
      await act(2_000_000_000, 'reactivate', superToken).expect(404);
    });
  });

  describe('GET /subscriptions?organizationId=', () => {
    let subA: number;
    let subB: number;

    before(async () => {
      const plan = await prisma.plan.create({
        data: { name: '[e2e] OrgManage', code: `E2E-ORGMANAGE-${TAG}`, priceCents: 1000, maxStudents: 5 },
      });
      planIds.push(plan.id);
      subA = (await prisma.subscription.create({ data: { organizationId: orgA.id, planId: plan.id, status: 'CANCELED' } })).id;
      const subA2 = await prisma.subscription.create({ data: { organizationId: orgA.id, planId: plan.id, status: 'ACTIVE' } });
      subB = (await prisma.subscription.create({ data: { organizationId: orgB.id, planId: plan.id, status: 'ACTIVE' } })).id;
      subA = Math.min(subA, subA2.id);
    });

    const list = (token: string | undefined, query = '') => {
      const req = request(server()).get(`/api/subscriptions${query}`);
      if (token) req.set('Authorization', `Bearer ${token}`);
      return req;
    };

    it('com organizationId devolve SÓ as assinaturas do grupo (mais recente primeiro)', async () => {
      const res = await list(superToken, `?organizationId=${orgA.id}`).expect(200);
      assert.equal(res.body.length, 2);
      assert.ok(res.body.every((s: { organizationId: number }) => s.organizationId === orgA.id));
      assert.ok(res.body[0].id > res.body[1].id, 'ordem id desc');
      const expected = await prisma.subscription.findMany({ where: { organizationId: orgA.id }, orderBy: { id: 'desc' } });
      assert.deepEqual(res.body.map((s: { id: number }) => s.id), expected.map((s) => s.id));
      assert.ok(!res.body.some((s: { id: number }) => s.id === subB));
    });

    it('grupo sem assinatura => []; sem filtro continua devolvendo as de todos os grupos', async () => {
      const empty = await list(superToken, `?organizationId=${orgIds[orgIds.length - 1] + 1000000}`).expect(200);
      assert.deepEqual(empty.body, []);
      const all = await list(superToken).expect(200);
      const orgsInAll = new Set(all.body.map((s: { organizationId: number }) => s.organizationId));
      assert.ok(orgsInAll.has(orgA.id) && orgsInAll.has(orgB.id));
      assert.ok(subA > 0);
    });

    it('organizationId inválido => 400; sem token => 401; MESTRE => 403', async () => {
      for (const bad of ['abc', '0', '-1', '1.5', '99999999999']) {
        await list(superToken, `?organizationId=${bad}`).expect(400);
      }
      await list(undefined, `?organizationId=${orgA.id}`).expect(401);
      const mestre = (await login(orgB.mestreEmail).expect(200)).body.accessToken;
      await list(mestre, `?organizationId=${orgB.id}`).expect(403);
    });
  });
});
