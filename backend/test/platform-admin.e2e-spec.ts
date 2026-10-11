import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * "SaaS Admin completo" — Fase 2, PLANO_PROJETO.md §10.14: Feature Overrides por organização e
 * Platform Announcements (avisos da equipe GingApp para os grupos, distinto do Announcement de
 * grupo). Ambos exclusivos da equipe PLATFORM (PlatformOnlyGuard), com uma única exceção de
 * leitura MEMBER-acessível em cada um (nenhuma em feature-overrides — não há tela de grupo para
 * isso; `GET /platform-announcements/mine` no caso dos avisos).
 *
 * Cria uma organização isolada própria desta suíte (nunca mexe na "Grupo Ginga Brasil" do seed),
 * apagada no after().
 */
const DEV_PASSWORD = 'Dev@12345';
const PLATFORM_EMAIL = 'owner@gingapp.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br'; // MEMBER qualquer, só para provar 403
const ORG_B_MESTRE_EMAIL = `mestre-b@e2e-platform-admin-${Date.now()}.local`;

async function login(app: INestApplication, email: string, path = '/api/auth/login'): Promise<string> {
  const res = await request(app.getHttpServer()).post(path).send({ email, password: DEV_PASSWORD }).expect(200);
  return res.body.accessToken;
}

describe('Feature Overrides & Platform Announcements (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let platformToken: string;
  let memberToken: string;
  let orgBToken: string;
  let orgBId: number;
  let orgBUserId: number;

  const createdOverrideIds: number[] = [];
  const createdAnnouncementIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    platformToken = await login(app, PLATFORM_EMAIL, '/api/auth/platform-login');
    memberToken = await login(app, ALUNO_EMAIL);

    const org = await prisma.organization.create({
      data: {
        name: 'E2E Platform Admin Org B',
        slug: `e2e-platform-admin-org-b-${Date.now()}`,
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
        name: 'Mestre E2E Org B (platform admin)',
        userType: 'MEMBER',
        status: 'ACTIVE',
      },
    });
    orgBUserId = userB.id;
    await prisma.organizationUser.create({
      data: { organizationId: org.id, userId: userB.id, role: OrgRole.MESTRE, status: 'ACTIVE' },
    });
    orgBToken = await login(app, ORG_B_MESTRE_EMAIL);
  });

  after(async () => {
    if (createdAnnouncementIds.length > 0) {
      // Avisos globais (sem targetOrganizationId) notificam TODO MUNDO, inclusive membros do
      // seed — limpa por prefixo de título (nunca por userId só) para não deixar notificação
      // de teste esquecida em contas reais do seed (mestre/professor/aluno/responsável).
      await prisma.notification.deleteMany({
        where: { type: 'PLATFORM_ANNOUNCEMENT', title: { startsWith: '[e2e]' } },
      });
      await prisma.platformAnnouncement.deleteMany({ where: { id: { in: createdAnnouncementIds } } });
    }
    if (createdOverrideIds.length > 0) {
      await prisma.organizationFeatureOverride.deleteMany({ where: { id: { in: createdOverrideIds } } });
    }
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgBId } });
    await prisma.user.delete({ where: { id: orgBUserId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('FeatureOverridesController — exclusivo da equipe PLATFORM', () => {
    it('GET .../feature-overrides com token MEMBER retorna 403', async () => {
      await request(app.getHttpServer())
        .get(`/api/organizations/${orgBId}/feature-overrides`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('GET .../feature-overrides de organização inexistente retorna 404', async () => {
      await request(app.getHttpServer())
        .get('/api/organizations/999999/feature-overrides')
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(404);
    });

    it('POST cria um override, confirmado via Prisma', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/organizations/${orgBId}/feature-overrides`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ featureKey: 'e2e.feature.beta', enabled: true, note: 'Piloto e2e' })
        .expect(201);
      createdOverrideIds.push(res.body.id);

      const persisted = await prisma.organizationFeatureOverride.findUnique({ where: { id: res.body.id } });
      assert.equal(persisted?.featureKey, 'e2e.feature.beta');
      assert.equal(persisted?.enabled, true);
    });

    it('POST com a mesma featureKey faz upsert (não duplica linha)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/organizations/${orgBId}/feature-overrides`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ featureKey: 'e2e.feature.beta', enabled: false, note: 'Desativado depois' })
        .expect(201);
      assert.equal(res.body.id, createdOverrideIds[0]);

      const count = await prisma.organizationFeatureOverride.count({
        where: { organizationId: orgBId, featureKey: 'e2e.feature.beta' },
      });
      assert.equal(count, 1);

      const persisted = await prisma.organizationFeatureOverride.findUnique({ where: { id: res.body.id } });
      assert.equal(persisted?.enabled, false);
    });

    it('PATCH edita note/enabled, confirmado via Prisma', async () => {
      await request(app.getHttpServer())
        .patch(`/api/organizations/${orgBId}/feature-overrides/${createdOverrideIds[0]}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ enabled: true, note: 'Reativado' })
        .expect(200);

      const persisted = await prisma.organizationFeatureOverride.findUniqueOrThrow({
        where: { id: createdOverrideIds[0] },
      });
      assert.equal(persisted.enabled, true);
      assert.equal(persisted.note, 'Reativado');
    });

    it('DELETE apaga de verdade (hard delete, sem valor de histórico)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/organizations/${orgBId}/feature-overrides/${createdOverrideIds[0]}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);

      const persisted = await prisma.organizationFeatureOverride.findUnique({
        where: { id: createdOverrideIds[0] },
      });
      assert.equal(persisted, null);
      createdOverrideIds.length = 0; // já apagado, after() não precisa tentar de novo
    });
  });

  describe('PlatformAnnouncementsController — avisos da equipe GingApp', () => {
    it('POST /platform-announcements com token MEMBER retorna 403', async () => {
      await request(app.getHttpServer())
        .post('/api/platform-announcements')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: '[e2e] Não deveria criar', body: 'xx' })
        .expect(403);
    });

    it('POST global (sem targetOrganizationId) notifica todo mundo, inclusive a org B', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform-announcements')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ title: '[e2e] Aviso global', body: 'Manutenção programada.' })
        .expect(201);
      createdAnnouncementIds.push(res.body.id);
      assert.equal(res.body.targetOrganizationId, null);

      const notified = await prisma.notification.findFirst({
        where: { userId: orgBUserId, type: 'PLATFORM_ANNOUNCEMENT', title: '[e2e] Aviso global' },
      });
      assert.ok(notified !== null);
    });

    it('GET /platform-announcements/mine (org B) mostra o aviso global', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/platform-announcements/mine')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);
      assert.ok(res.body.some((a: { title: string }) => a.title === '[e2e] Aviso global'));
    });

    it('POST direcionado só à org B NÃO aparece em mine de outra organização (seed)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/platform-announcements')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ title: '[e2e] Só para org B', body: 'xx', targetOrganizationId: orgBId })
        .expect(201);
      createdAnnouncementIds.push(res.body.id);

      const mineOrgB = await request(app.getHttpServer())
        .get('/api/platform-announcements/mine')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);
      assert.ok(mineOrgB.body.some((a: { title: string }) => a.title === '[e2e] Só para org B'));

      const mineSeedOrg = await request(app.getHttpServer())
        .get('/api/platform-announcements/mine')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      assert.ok(!mineSeedOrg.body.some((a: { title: string }) => a.title === '[e2e] Só para org B'));
    });

    it('POST com targetOrganizationId inexistente retorna 400', async () => {
      await request(app.getHttpServer())
        .post('/api/platform-announcements')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ title: '[e2e] Alvo inválido', body: 'xx', targetOrganizationId: 999999 })
        .expect(400);
    });

    it('um aviso expirado não aparece em mine', async () => {
      // expiresAt no passado é recusado na criação (400); o aviso "que já expirou" nasce com
      // expiração futura e é expirado direto no banco.
      const res = await request(app.getHttpServer())
        .post('/api/platform-announcements')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ title: '[e2e] Já expirou', body: 'xx', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
        .expect(201);
      createdAnnouncementIds.push(res.body.id);
      await prisma.platformAnnouncement.update({
        where: { id: res.body.id },
        data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });

      const mine = await request(app.getHttpServer())
        .get('/api/platform-announcements/mine')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);
      assert.ok(!mine.body.some((a: { title: string }) => a.title === '[e2e] Já expirou'));
    });

    it('PATCH edita o título sem renotificar', async () => {
      const before = await prisma.notification.count({ where: { type: 'PLATFORM_ANNOUNCEMENT' } });

      await request(app.getHttpServer())
        .patch(`/api/platform-announcements/${createdAnnouncementIds[0]}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ title: '[e2e] Aviso global (editado)' })
        .expect(200);

      const after = await prisma.notification.count({ where: { type: 'PLATFORM_ANNOUNCEMENT' } });
      assert.equal(after, before);

      const persisted = await prisma.platformAnnouncement.findUniqueOrThrow({
        where: { id: createdAnnouncementIds[0] },
      });
      assert.equal(persisted.title, '[e2e] Aviso global (editado)');
    });

    it('DELETE é soft delete — isActive vira false, registro nunca some, some de mine', async () => {
      await request(app.getHttpServer())
        .delete(`/api/platform-announcements/${createdAnnouncementIds[0]}`)
        .set('Authorization', `Bearer ${platformToken}`)
        .expect(200);

      const persisted = await prisma.platformAnnouncement.findUniqueOrThrow({
        where: { id: createdAnnouncementIds[0] },
      });
      assert.equal(persisted.isActive, false);

      const mine = await request(app.getHttpServer())
        .get('/api/platform-announcements/mine')
        .set('Authorization', `Bearer ${orgBToken}`)
        .expect(200);
      assert.ok(!mine.body.some((a: { title: string }) => a.title === '[e2e] Aviso global (editado)'));
    });
  });
});
