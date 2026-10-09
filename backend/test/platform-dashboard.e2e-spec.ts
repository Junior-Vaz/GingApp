import { INestApplication } from '@nestjs/common';
import { OrganizationType, PrismaClient, RecordStatus, SubscriptionStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * GET /platform-dashboard — métricas agregadas da plataforma (somente PLATFORM).
 *
 * Não depende de contagem global (seed e outras suítes criam dados): (1) lê o dashboard ANTES de
 * criar os dados desta suíte e DEPOIS, e confere os deltas; (2) recalcula tudo com Prisma
 * (findMany + soma em JS — método diferente do groupBy/count do service) no mesmo instante e
 * compara com a resposta HTTP.
 */
const DEV_PASSWORD = 'Dev@12345';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const OPEN_FOR_PLAN: SubscriptionStatus[] = ['ACTIVE', 'TRIALING'];

interface Dashboard {
  generatedAt: string;
  organizations: { total: number; active: number; inactive: number };
  newOrganizationsLast30Days: number;
  students: { active: number };
  subscriptions: {
    byStatus: Record<string, number>;
    byPlan: Array<{ planId: number; code: string; name: string; count: number }>;
  };
  mrrCents: number;
  mrrIgnoredSubscriptions: number;
  recentOrganizations: Array<{
    id: number;
    name: string;
    slug: string;
    createdAt: string;
    currentPlan: { id: number; code: string; name: string; subscriptionStatus: string } | null;
  }>;
}

describe('Platform dashboard (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let platformToken: string;
  let memberToken: string;

  const orgIds: number[] = [];
  const planIds: number[] = [];
  const subscriptionIds: number[] = [];
  const studentIds: number[] = [];
  let planMonthly: { id: number; code: string };
  let planYearly: { id: number; code: string };
  let planWeird: { id: number; code: string };
  let lastOrgId: number;
  let baseline: Dashboard;

  const get = (token?: string) => {
    const req = request(app.getHttpServer()).get('/api/platform-dashboard');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  before(async () => {
    app = await createTestApp();
    const platform = await request(app.getHttpServer())
      .post('/api/auth/platform-login')
      .send({ email: PLATFORM_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    platformToken = platform.body.accessToken;
    memberToken = (await loginAs(app, MESTRE_EMAIL)).token;

    baseline = (await get(platformToken).expect(200)).body;

    const tag = `${Date.now()}`;
    const mkPlan = async (code: string, priceCents: number, billingPeriod: string) => {
      const plan = await prisma.plan.create({
        data: { name: `[e2e-dash] ${code}`, code: `E2E-DASH-${code}-${tag}`, priceCents, billingPeriod },
      });
      planIds.push(plan.id);
      return plan;
    };
    planMonthly = await mkPlan('M', 1000, 'MONTHLY');
    planYearly = await mkPlan('Y', 12345, 'YEARLY');
    planWeird = await mkPlan('W', 777, 'WEEKLY'); // periodicidade fora do contrato da API: ignorada no MRR

    const mkOrg = async (n: string, status: RecordStatus = RecordStatus.ACTIVE) => {
      const org = await prisma.organization.create({
        data: { name: `E2E Dash ${n}`, slug: `e2e-dash-${n}-${tag}`, type: OrganizationType.GROUP, status },
      });
      orgIds.push(org.id);
      return org;
    };
    const mkSub = async (organizationId: number, planId: number, status: SubscriptionStatus) => {
      const sub = await prisma.subscription.create({ data: { organizationId, planId, status } });
      subscriptionIds.push(sub.id);
    };

    const a = await mkOrg('a');
    const b = await mkOrg('b');
    const c = await mkOrg('c');
    const d = await mkOrg('d');
    const e = await mkOrg('e');
    await mkOrg('f-inactive', RecordStatus.INACTIVE);
    await mkSub(a.id, planMonthly.id, 'ACTIVE');
    await mkSub(b.id, planYearly.id, 'ACTIVE');
    await mkSub(c.id, planMonthly.id, 'TRIALING');
    await mkSub(d.id, planWeird.id, 'ACTIVE');
    await mkSub(e.id, planMonthly.id, 'CANCELED');

    const mkStudent = async (organizationId: number, name: string, status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') => {
      const s = await prisma.student.create({ data: { organizationId, name: `[e2e-dash] ${name}`, status } });
      studentIds.push(s.id);
    };
    await mkStudent(a.id, 'a1', 'ACTIVE');
    await mkStudent(a.id, 'a2', 'ACTIVE');
    await mkStudent(b.id, 'b1', 'ACTIVE');
    await mkStudent(b.id, 'b2', 'INACTIVE');
    await mkStudent(c.id, 'c1', 'SUSPENDED');

    // A org MAIS RECENTE, com assinatura em teste: precisa aparecer em recentOrganizations[0].
    const last = await mkOrg('z-last');
    lastOrgId = last.id;
    await mkSub(last.id, planMonthly.id, 'TRIALING');
  });

  after(async () => {
    await prisma.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
    await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('sem token => 401; MEMBER (MESTRE) => 403', async () => {
    await get().expect(401);
    await get(memberToken).expect(403);
  });

  it('PLATFORM => 200 com o formato do contrato (todos os status do enum, sem dados pessoais)', async () => {
    const res = await get(platformToken).expect(200);
    const body: Dashboard = res.body;
    assert.deepEqual(
      Object.keys(body).sort(),
      [
        'generatedAt',
        'mrrCents',
        'mrrIgnoredSubscriptions',
        'newOrganizationsLast30Days',
        'organizations',
        'recentOrganizations',
        'students',
        'subscriptions',
      ].sort(),
    );
    assert.deepEqual(Object.keys(body.subscriptions.byStatus).sort(), Object.values(SubscriptionStatus).sort());
    assert.ok(body.recentOrganizations.length <= 5);
    for (const org of body.recentOrganizations) {
      assert.deepEqual(Object.keys(org).sort(), ['createdAt', 'currentPlan', 'id', 'name', 'slug']);
    }
  });

  it('deltas em relação ao baseline batem com os dados criados nesta suíte', async () => {
    const after: Dashboard = (await get(platformToken).expect(200)).body;

    assert.equal(after.organizations.total - baseline.organizations.total, 7);
    assert.equal(after.organizations.active - baseline.organizations.active, 6);
    assert.equal(after.organizations.inactive - baseline.organizations.inactive, 1);
    assert.equal(after.newOrganizationsLast30Days - baseline.newOrganizationsLast30Days, 7);
    assert.equal(after.students.active - baseline.students.active, 3); // a1, a2, b1 (INACTIVE/SUSPENDED fora)

    const dStatus = (s: string) => after.subscriptions.byStatus[s] - baseline.subscriptions.byStatus[s];
    assert.equal(dStatus('ACTIVE'), 3);
    assert.equal(dStatus('TRIALING'), 2);
    assert.equal(dStatus('CANCELED'), 1);
    assert.equal(dStatus('PAST_DUE'), 0);
    assert.equal(dStatus('EXPIRED'), 0);

    // MRR: 1000 (mensal) + 12345/12 = 1028.75 (anual) => +2028.75; o plano WEEKLY fica fora e é contado à parte.
    assert.ok(Math.abs(after.mrrCents - baseline.mrrCents - 2028.75) <= 1, `delta mrr = ${after.mrrCents - baseline.mrrCents}`);
    assert.equal(after.mrrIgnoredSubscriptions - baseline.mrrIgnoredSubscriptions, 1);
  });

  it('byPlan conta só ACTIVE/TRIALING por plano, com code e name', async () => {
    const body: Dashboard = (await get(platformToken).expect(200)).body;
    const find = (id: number) => body.subscriptions.byPlan.find((p) => p.planId === id);
    assert.equal(find(planMonthly.id)?.count, 3); // a ACTIVE + c TRIALING + z-last TRIALING (e CANCELED fora)
    assert.equal(find(planYearly.id)?.count, 1);
    assert.equal(find(planWeird.id)?.count, 1);
    assert.equal(find(planMonthly.id)?.code, planMonthly.code);
    assert.equal(find(planMonthly.id)?.name, '[e2e-dash] M');
    const counts = body.subscriptions.byPlan.map((p) => p.count);
    assert.deepEqual(counts, [...counts].sort((x, y) => y - x), 'byPlan ordenado por count desc');
  });

  it('o resultado HTTP bate com o recálculo independente via Prisma (mesmo instante)', async () => {
    const body: Dashboard = (await get(platformToken).expect(200)).body;

    const orgs = await prisma.organization.findMany({ where: { type: 'GROUP' }, select: { status: true, createdAt: true } });
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    assert.equal(body.organizations.total, orgs.length);
    assert.equal(body.organizations.active, orgs.filter((o) => o.status === 'ACTIVE').length);
    assert.equal(body.organizations.inactive, orgs.filter((o) => o.status === 'INACTIVE').length);
    assert.equal(body.newOrganizationsLast30Days, orgs.filter((o) => o.createdAt.getTime() >= since).length);

    const students = await prisma.student.findMany({
      where: { status: 'ACTIVE' },
      select: { organization: { select: { type: true } } },
    });
    assert.equal(body.students.active, students.filter((s) => s.organization.type === 'GROUP').length);

    const subs = await prisma.subscription.findMany({
      select: { status: true, planId: true, plan: { select: { priceCents: true, billingPeriod: true } } },
    });
    for (const status of Object.values(SubscriptionStatus)) {
      assert.equal(body.subscriptions.byStatus[status], subs.filter((s) => s.status === status).length, status);
    }

    const expectedByPlan = new Map<number, number>();
    for (const s of subs.filter((x) => OPEN_FOR_PLAN.includes(x.status))) {
      expectedByPlan.set(s.planId, (expectedByPlan.get(s.planId) ?? 0) + 1);
    }
    assert.equal(body.subscriptions.byPlan.length, expectedByPlan.size);
    for (const row of body.subscriptions.byPlan) {
      assert.equal(row.count, expectedByPlan.get(row.planId), `plano ${row.code}`);
    }

    let exactMrr = 0;
    let ignored = 0;
    for (const s of subs.filter((x) => x.status === 'ACTIVE')) {
      if (s.plan.billingPeriod === 'MONTHLY') exactMrr += s.plan.priceCents;
      else if (s.plan.billingPeriod === 'YEARLY') exactMrr += s.plan.priceCents / 12;
      else ignored += 1;
    }
    assert.equal(body.mrrCents, Math.round(exactMrr));
    assert.equal(body.mrrIgnoredSubscriptions, ignored);

    const recent = await prisma.organization.findMany({
      where: { type: 'GROUP' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { id: true },
    });
    assert.deepEqual(
      body.recentOrganizations.map((o) => o.id),
      recent.map((o) => o.id),
    );
  });

  it('recentOrganizations[0] é a org mais nova, com o plano atual (TRIALING)', async () => {
    const body: Dashboard = (await get(platformToken).expect(200)).body;
    const first = body.recentOrganizations[0];
    assert.equal(first.id, lastOrgId);
    assert.equal(first.currentPlan?.code, planMonthly.code);
    assert.equal(first.currentPlan?.subscriptionStatus, 'TRIALING');
    // Sem assinatura => null (f-inactive); só CANCELED não é "aberta" => null (e).
    assert.ok(body.recentOrganizations[1].slug.startsWith('e2e-dash-f-inactive'));
    assert.equal(body.recentOrganizations[1].currentPlan, null);
    assert.ok(body.recentOrganizations[2].slug.startsWith('e2e-dash-e-'));
    assert.equal(body.recentOrganizations[2].currentPlan, null);
  });
});
