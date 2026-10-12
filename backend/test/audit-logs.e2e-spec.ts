import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Trilha de auditoria (AuditService + GET /audit-logs e /audit-logs/me-group). Dois grupos PRÓPRIOS da suíte
 * (não toca no seed ginga-brasil nem no demo). Tudo via HTTP real; conferência independente no Postgres.
 * Limpa tudo o que cria no after().
 */
const DOMAIN = '@e2e-audit.local';

describe('Auditoria (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let orgId: number;
  let otherOrgId: number;
  let platformUserId: number;
  let platformToken: string;
  const tokens: Record<string, string> = {};
  const userIds: Record<string, number> = {};
  const emails: Record<string, string> = {};

  async function makeUser(key: string, role: OrgRole, organizationId: number): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: `${key}-${stamp}${DOMAIN}`,
        passwordHash: await bcrypt.hash(DEV_PASSWORD, 4),
        name: `[e2e-audit] ${key}`,
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    userIds[key] = user.id;
    emails[key] = user.email;
    const login = await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200);
    tokens[key] = login.body.accessToken;
  }

  before(async () => {
    app = await createTestApp();
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E audit ${stamp}`, slug: `e2e-audit-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    otherOrgId = (
      await prisma.organization.create({
        data: { name: `E2E audit other ${stamp}`, slug: `e2e-audit-other-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    await prisma.unit.create({ data: { organizationId: orgId, name: 'Matriz', isMain: true } });
    await prisma.unit.create({ data: { organizationId: otherOrgId, name: 'Matriz', isMain: true } });
    await makeUser('mestre', OrgRole.MESTRE, orgId);
    await makeUser('professor', OrgRole.PROFESSOR, orgId);
    await makeUser('professorPw', OrgRole.PROFESSOR, orgId);
    await makeUser('mestreOther', OrgRole.MESTRE, otherOrgId);
    const platform = await createPlatformUser(prisma, 'audit', { isSuperAdmin: true });
    platformUserId = platform.id;
    platformToken = await platformLogin(app, platform.email);
  });

  after(async () => {
    const users = await prisma.user.findMany({
      where: { OR: [{ email: { endsWith: DOMAIN } }, { id: platformUserId }] },
      select: { id: true },
    });
    const userIdList = users.map((u) => u.id);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ organizationId: { in: [orgId, otherOrgId] } }, { userId: { in: userIdList } }] },
    });
    await prisma.organizationFeatureOverride.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.unit.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIdList } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('login com sucesso e com falha grava a trilha: falha só com motivo e contagem, NUNCA a senha', async () => {
    const wrong = 'Senha-Errada-Secreta-123';
    await http().post('/api/auth/login').send({ email: emails.professor, password: wrong }).expect(401);
    await http().post('/api/auth/login').send({ email: emails.professor, password: wrong }).expect(401);

    const failures = await prisma.auditLog.findMany({
      where: { userId: userIds.professor, action: 'LOGIN_FAILURE' },
      orderBy: { id: 'asc' },
    });
    assert.equal(failures.length, 2);
    assert.equal(failures[0].organizationId, orgId);
    assert.equal((failures[0].metadata as { recentFailures: number }).recentFailures, 1);
    assert.equal((failures[1].metadata as { recentFailures: number }).recentFailures, 2);
    assert.ok(!JSON.stringify(failures).includes(wrong), 'a senha digitada não pode aparecer na trilha');

    const success = await prisma.auditLog.count({ where: { userId: userIds.mestre, action: 'LOGIN_SUCCESS', organizationId: orgId } });
    assert.ok(success >= 1);
  });

  it('ação sensível grava autor, grupo e IP da requisição (criar unidade)', async () => {
    const res = await http().post('/api/units').set(auth(tokens.mestre)).send({ name: `Filial ${stamp}` }).expect(201);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'UNIT_CREATE', resourceId: String(res.body.id) } });
    assert.equal(row.userId, userIds.mestre);
    assert.equal(row.organizationId, orgId);
    assert.equal(row.resource, 'unit');
    assert.ok(row.ipAddress, 'o IP da requisição deve ser gravado');
  });

  it('troca de senha grava PASSWORD_CHANGE sem nenhuma senha na trilha', async () => {
    const newPassword = 'Nova-Senha-Forte-2026!x';
    await http()
      .post('/api/auth/change-password')
      .set(auth(tokens.professorPw))
      .send({ currentPassword: DEV_PASSWORD, newPassword })
      .expect(200);
    const rows = await prisma.auditLog.findMany({ where: { userId: userIds.professorPw, action: 'PASSWORD_CHANGE' } });
    assert.equal(rows.length, 1);
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes(newPassword) && !dump.includes(DEV_PASSWORD) && !/\$2[aby]\$/.test(dump));
  });

  describe('GET /audit-logs/me-group (MESTRE)', () => {
    it('lista só o próprio grupo, com filtro por ação e X-Total-Count; professor 403; sem token 401', async () => {
      // Atividade no OUTRO grupo: não pode aparecer para o Mestre do primeiro.
      await http().post('/api/units').set(auth(tokens.mestreOther)).send({ name: `Outra filial ${stamp}` }).expect(201);

      const all = await http().get('/api/audit-logs/me-group?limit=200').set(auth(tokens.mestre)).expect(200);
      assert.ok(all.body.length >= 3);
      assert.ok(all.body.every((r: { organizationId: number }) => r.organizationId === orgId));
      assert.equal(Number(all.headers['x-total-count']), all.body.length);

      const filtered = await http().get('/api/audit-logs/me-group?action=UNIT_CREATE').set(auth(tokens.mestre)).expect(200);
      assert.ok(filtered.body.length >= 1);
      assert.ok(filtered.body.every((r: { action: string }) => r.action === 'UNIT_CREATE'));

      // `organizationId` de outro grupo na query é ignorado: o grupo vem sempre do token.
      const spoof = await http().get(`/api/audit-logs/me-group?organizationId=${otherOrgId}`).set(auth(tokens.mestre)).expect(200);
      assert.ok(spoof.body.every((r: { organizationId: number }) => r.organizationId === orgId));

      await http().get('/api/audit-logs/me-group').set(auth(tokens.professor)).expect(403);
      await http().get('/api/audit-logs/me-group').expect(401);
    });

    it('esconde a identidade da equipe da plataforma nas ações dela sobre o grupo', async () => {
      await http()
        .post(`/api/organizations/${orgId}/feature-overrides`)
        .set(auth(platformToken))
        .send({ featureKey: 'certificates', enabled: true })
        .expect(201);
      const res = await http().get('/api/audit-logs/me-group?action=FEATURE_OVERRIDE_SET').set(auth(tokens.mestre)).expect(200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].userName, 'Equipe GingApp');
      assert.equal(res.body[0].userEmail, null);
      assert.equal(res.body[0].userId, null);
      assert.equal(res.body[0].ip, null);
    });
  });

  describe('GET /audit-logs (plataforma)', () => {
    it('vê todos os grupos, filtra por grupo/ação/usuário/período; Mestre 403', async () => {
      const both = await http().get('/api/audit-logs?limit=200').set(auth(platformToken)).expect(200);
      const orgs = new Set(both.body.map((r: { organizationId: number | null }) => r.organizationId));
      assert.ok(orgs.has(orgId) && orgs.has(otherOrgId), 'a plataforma deve ver os dois grupos');
      assert.ok(Number(both.headers['x-total-count']) >= both.body.length);

      const byOrg = await http().get(`/api/audit-logs?organizationId=${otherOrgId}`).set(auth(platformToken)).expect(200);
      assert.ok(byOrg.body.length >= 1 && byOrg.body.every((r: { organizationId: number }) => r.organizationId === otherOrgId));

      const byUser = await http()
        .get(`/api/audit-logs?userId=${userIds.mestre}&action=UNIT_CREATE`)
        .set(auth(platformToken))
        .expect(200);
      assert.ok(byUser.body.length >= 1);
      assert.ok(byUser.body.every((r: { userId: number; action: string }) => r.userId === userIds.mestre && r.action === 'UNIT_CREATE'));
      assert.ok(byUser.body[0].userEmail.endsWith(DOMAIN));

      const today = new Date().toISOString().slice(0, 10);
      const inRange = await http().get(`/api/audit-logs?organizationId=${orgId}&from=${today}&to=${today}`).set(auth(platformToken)).expect(200);
      assert.ok(inRange.body.length >= 1);
      const past = await http().get(`/api/audit-logs?organizationId=${orgId}&to=2020-01-01`).set(auth(platformToken)).expect(200);
      assert.equal(past.body.length, 0);

      await http().get('/api/audit-logs').set(auth(tokens.mestre)).expect(403);
      await http().get('/api/audit-logs?limit=0').set(auth(platformToken)).expect(400);
    });
  });
});
