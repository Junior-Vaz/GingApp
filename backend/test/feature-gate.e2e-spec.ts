import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { SecondOrg, createSecondOrg } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Recursos por plano/grupo (FeatureGuard + @RequireFeature): `Plan.features` e `OrganizationFeatureOverride`
 * passam a BLOQUEAR módulos (certificados, financeiro) com 403. Grupo e plano PRÓPRIOS da suíte.
 * Precedência: override do grupo > Plan.features > padrão (ligado).
 */
describe('Recursos por plano/grupo (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: SecondOrg;
  let platformUserId: number;
  let platformToken: string;
  let planId: number;
  const tag = `${Date.now()}`;

  const mestreGet = (path: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${org.token}`);
  const platform = (method: 'post' | 'delete', path: string) =>
    request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${platformToken}`);

  before(async () => {
    app = await createTestApp();
    org = await createSecondOrg(app, prisma, 'feat');
    const user = await createPlatformUser(prisma, 'feat', { isSuperAdmin: true });
    platformUserId = user.id;
    platformToken = await platformLogin(app, user.email);
    planId = (
      await prisma.plan.create({
        data: { name: `[e2e-feat] ${tag}`, code: `E2E-FEAT-${tag}`, features: { certificates: false } },
      })
    ).id;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: org.organizationId }, { userId: platformUserId }] } });
    await prisma.organizationFeatureOverride.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.subscriptionEvent.deleteMany({ where: { subscription: { organizationId: org.organizationId } } });
    await prisma.subscription.deleteMany({ where: { organizationId: org.organizationId } });
    await prisma.plan.deleteMany({ where: { id: planId } });
    await prisma.user.deleteMany({ where: { id: platformUserId } });
    await org.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem plano nem override o recurso está ligado (padrão): grupos existentes não quebram', async () => {
    await mestreGet('/certificates').expect(200);
    await mestreGet('/finance').expect(200);
  });

  it('Plan.features com { certificates: false } bloqueia /certificates (403) e não afeta o financeiro', async () => {
    await prisma.subscription.create({
      data: { organizationId: org.organizationId, planId, status: 'ACTIVE', gatewayProvider: 'stub' },
    });
    const res = await mestreGet('/certificates').expect(403);
    assert.match(res.body.message, /Certificados/);
    await mestreGet('/finance').expect(200);
  });

  it('o override do grupo vence o plano: liga de volta o recurso e depois o desliga de novo', async () => {
    const created = await platform('post', `/organizations/${org.organizationId}/feature-overrides`)
      .send({ featureKey: 'certificates', enabled: true })
      .expect(201);
    await mestreGet('/certificates').expect(200);

    await platform('post', `/organizations/${org.organizationId}/feature-overrides`)
      .send({ featureKey: 'finance', enabled: false })
      .expect(201);
    await mestreGet('/finance').expect(403);
    await mestreGet('/finance/summary').expect(403);

    // Remover o override volta ao padrão do plano (certificados bloqueados pelo plano).
    await platform('delete', `/organizations/${org.organizationId}/feature-overrides/${created.body.id}`).expect(200);
    await mestreGet('/certificates').expect(403);
  });

  it('a equipe da plataforma não é afetada pelo bloqueio do grupo', async () => {
    const res = await request(app.getHttpServer()).get('/api/certificates').set('Authorization', `Bearer ${platformToken}`);
    assert.ok(!String(res.body?.message ?? '').includes('não está disponível'), 'o FeatureGuard não bloqueia a equipe da plataforma');
  });
});
