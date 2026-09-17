import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, Plan, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Billing (Plans/Subscriptions), Fase 2 — PLANO_PROJETO.md §10.13.
 *
 * Cobre: PlatformOnlyGuard (primeiro uso real — MEMBER sempre 403 em /plans e nas rotas
 * platform-only de /subscriptions), CRUD de planos, ciclo de vida de assinatura (criar via
 * BillingGatewayService stub, trocar de plano, cancelar), o audit trail em SubscriptionEvent,
 * e o enforcement de Plan.maxStudents em StudentsService.create.
 *
 * Cria uma organização isolada própria desta suíte (nunca mexe na "Grupo Ginga Brasil" do
 * seed), apagada no after() na ordem certa (SubscriptionEvent -> Subscription -> Plan/Student/
 * OrganizationUser/User -> Organization) por causa das FKs RESTRICT do schema.
 */
const DEV_PASSWORD = 'Dev@12345';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br'; // MEMBER qualquer, só para provar 403 em rota platform-only
const ORG_B_MESTRE_EMAIL = `mestre-b@e2e-billing-${Date.now()}.local`;

async function login(app: INestApplication, email: string, path = '/api/auth/login'): Promise<string> {
  const res = await request(app.getHttpServer()).post(path).send({ email, password: DEV_PASSWORD }).expect(200);
  return res.body.accessToken;
}

describe('Plans & Subscriptions — billing (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let platformToken: string;
  let memberToken: string;
  let orgBToken: string;
  let orgBId: number;
  let orgBUserId: number;

  let planLow: Plan; // maxStudents = 1
  let planHigh: Plan; // maxStudents = 5
  const createdCatalogPlanIds: number[] = [];
  let subscriptionId: number;
  const createdStudentIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    platformToken = await login(app, PLATFORM_EMAIL, '/api/auth/platform-login');
    memberToken = await login(app, ALUNO_EMAIL);

    const org = await prisma.organization.create({
      data: {
        name: 'E2E Billing Org B',
        slug: `e2e-billing-org-b-${Date.now()}`,
        type: OrganizationType.GROUP,
        status: RecordStatus.ACTIVE,
      },
    });
    orgBId = org.id;

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4);
    const userB = await prisma.user.create({
      data: {
        email: ORG_B_MESTRE_EMAIL,
        passwordHash,
        name: 'Mestre E2E Org B (billing)',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    orgBUserId = userB.id;
    await prisma.organizationUser.create({
      data: { organizationId: org.id, userId: userB.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });
    orgBToken = await login(app, ORG_B_MESTRE_EMAIL);

    const suffix = Date.now();
    planLow = await prisma.plan.create({
      data: { name: '[e2e] Baixo', code: `E2E-LOW-${suffix}`, priceCents: 1000, maxStudents: 1 },
    });
    planHigh = await prisma.plan.create({
      data: { name: '[e2e] Alto', code: `E2E-HIGH-${suffix}`, priceCents: 5000, maxStudents: 5 },
    });
  });

  after(async () => {
    if (subscriptionId) {
      await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId } });
      await prisma.subscription.deleteMany({ where: { id: subscriptionId } });
    }
    if (createdStudentIds.length > 0) {
      await prisma.student.deleteMany({ where: { id: { in: createdStudentIds } } });
    }
    await prisma.plan.deleteMany({ where: { id: { in: [planLow.id, planHigh.id, ...createdCatalogPlanIds] } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgBId } });
    await prisma.user.delete({ where: { id: orgBUserId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('PlansController — exclusivo da equipe PLATFORM', () => {
    it('GET /plans com token MEMBER retorna 403 (PlatformOnlyGuard)', async () => {
      await request(app.getHttpServer())
        .get('/api/plans')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('GET /plans com token PLATFORM lista o catálogo (inclui os planos do seed)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/plans')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.some((p: { code: string }) => p.code === 'UNICO'));
    });

    it('POST /plans cria um plano, confirmado via Prisma', async () => {
      const code = `E2E-CREATE-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/api/plans')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: '[e2e] Criado via HTTP', code, priceCents: 2500, maxStudents: 10 })
        .expect(201);
      createdCatalogPlanIds.push(res.body.id);

      const persisted = await prisma.plan.findUnique({ where: { id: res.body.id } });
      assert.equal(persisted?.code, code);
      assert.equal(persisted?.isActive, true);
    });

    it('POST /plans com code duplicado retorna 409 e nada é gravado', async () => {
      const beforeCount = await prisma.plan.count();
      await request(app.getHttpServer())
        .post('/api/plans')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: '[e2e] Duplicado', code: planLow.code, priceCents: 100 })
        .expect(409);
      const afterCount = await prisma.plan.count();
      assert.equal(afterCount, beforeCount);
    });

    it('PATCH edita e DELETE desativa (isActive=false) sem nunca apagar o registro', async () => {
      const code = `E2E-TOGGLE-${Date.now()}`;
      const created = await request(app.getHttpServer())
        .post('/api/plans')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ name: '[e2e] Toggle', code, priceCents: 100 })
        .expect(201);
      createdCatalogPlanIds.push(created.body.id);

      await request(app.getHttpServer())
        .patch(`/api/plans/${created.body.id}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ priceCents: 200 })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/plans/${created.body.id}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);

      const persisted = await prisma.plan.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(persisted.priceCents, 200);
      assert.equal(persisted.isActive, false);
    });
  });

  describe('SubscriptionsController — ciclo de vida + gateway stub + limite de plano', () => {
    it('POST /subscriptions com token MEMBER retorna 403', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ organizationId: orgBId, planId: planLow.id })
        .expect(403);
    });

    it('POST /subscriptions (platform) cria assinatura chamando o BillingGatewayService stub', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ organizationId: orgBId, planId: planLow.id })
        .expect(201);
      subscriptionId = res.body.id;

      assert.equal(res.body.status, 'ACTIVE');
      assert.equal(res.body.gatewayProvider, 'stub');
      assert.ok(res.body.gatewayCustomerId?.startsWith('stub-cust-'));
      assert.ok(res.body.gatewaySubscriptionId?.startsWith('stub-sub-'));

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId } });
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'CREATED');
    });

    it('POST /subscriptions para organização com assinatura já em aberto retorna 409', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ organizationId: orgBId, planId: planHigh.id })
        .expect(409);
    });

    it('GET /subscriptions/me (member da org B) retorna a própria assinatura', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/me')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);
      assert.equal(res.body.id, subscriptionId);
      assert.equal(res.body.plan.code, planLow.code);
    });

    it('POST /students respeita Plan.maxStudents=1 da assinatura aberta', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/students')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ name: '[e2e-billing] Aluno 1' })
        .expect(201);
      createdStudentIds.push(first.body.id);

      const beforeCount = await prisma.student.count({ where: { organizationId: orgBId, status: 'ACTIVE' } });
      assert.equal(beforeCount, 1);

      const blocked = await request(app.getHttpServer())
        .post('/api/students')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ name: '[e2e-billing] Aluno 2 (deveria falhar)' })
        .expect(400);
      assert.match(blocked.body.message, /Limite de 1 alunos/);

      const afterCount = await prisma.student.count({ where: { organizationId: orgBId, status: 'ACTIVE' } });
      assert.equal(afterCount, 1);
    });

    it('PATCH /subscriptions/:id (platform) troca de plano e loga evento UPDATED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${subscriptionId}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ planId: planHigh.id })
        .expect(200);
      assert.equal(res.body.planId, planHigh.id);

      const events = await prisma.subscriptionEvent.findMany({
        where: { subscriptionId, type: 'UPDATED' },
      });
      assert.equal(events.length, 1);
    });

    it('após upgrade para maxStudents=5, um segundo aluno agora é aceito', async () => {
      const second = await request(app.getHttpServer())
        .post('/api/students')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ name: '[e2e-billing] Aluno 2 (agora cabe)' })
        .expect(201);
      createdStudentIds.push(second.body.id);
    });

    it('POST /subscriptions/:id/cancel (platform) cancela e loga evento CANCELED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/subscriptions/${subscriptionId}/cancel`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(201);
      assert.equal(res.body.status, 'CANCELED');
      assert.ok(res.body.canceledAt);

      const events = await prisma.subscriptionEvent.findMany({
        where: { subscriptionId, type: 'CANCELED' },
      });
      assert.equal(events.length, 1);
    });

    it('cancelar uma assinatura já cancelada retorna 400', async () => {
      await request(app.getHttpServer())
        .post(`/api/subscriptions/${subscriptionId}/cancel`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(400);
    });
  });
});
