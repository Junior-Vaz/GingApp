import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { DEV_PASSWORD } from './utils/list-helpers';
import { createPlatformUser, platformLogin } from './utils/platform-team-fixtures';
import { createTestApp } from './utils/test-app';

/**
 * GET/PATCH /data-deletion-requests (plataforma). Grupo, usuarios e pedidos PROPRIOS da suite (nao toca no seed
 * ginga-brasil nem no demo). Marcar DONE NAO apaga nada: o usuario e o grupo continuam la. Limpa tudo no after().
 */
const DOMAIN = '@e2e-lgpd.local';

describe('Pedidos de exclusao de dados - plataforma (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}`;
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let orgId: number;
  let mestreToken = '';
  let superToken = '';
  let plainToken = '';
  let userId: number;
  let requestId: number;
  const platformIds: number[] = [];

  before(async () => {
    app = await createTestApp();
    orgId = (
      await prisma.organization.create({
        data: { name: `E2E lgpd ${stamp}`, slug: `e2e-lgpd-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
      })
    ).id;
    const user = await prisma.user.create({
      data: { email: `mestre-${stamp}${DOMAIN}`, passwordHash: await bcrypt.hash(DEV_PASSWORD, 4), name: '[e2e-lgpd] mestre', userType: 'MEMBER' },
    });
    userId = user.id;
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId, role: OrgRole.MESTRE, status: 'ACTIVE' } });
    mestreToken = (await http().post('/api/auth/login').send({ email: user.email, password: DEV_PASSWORD }).expect(200)).body.accessToken;
    const sup = await createPlatformUser(prisma, 'lgpd-super', { isSuperAdmin: true });
    const plain = await createPlatformUser(prisma, 'lgpd-plain');
    platformIds.push(sup.id, plain.id);
    superToken = await platformLogin(app, sup.email);
    plainToken = await platformLogin(app, plain.email);
    // pedido feito pelo proprio usuario (rota real) => nasce PENDING
    const created = await http().post('/api/auth/me/delete-request').set(auth(mestreToken)).send({ reason: 'quero sair' }).expect(200);
    requestId = created.body.id;
  });

  after(async () => {
    const ids = (
      await prisma.user.findMany({ where: { OR: [{ email: { endsWith: DOMAIN } }, { id: { in: platformIds } }] }, select: { id: true } })
    ).map((x) => x.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: orgId }, { userId: { in: ids } }] } });
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('lista com filtros (status, grupo, periodo) e total no header; equipe sem super admin tambem le', async () => {
    const all = await http().get(`/api/data-deletion-requests?organizationId=${orgId}`).set(auth(plainToken)).expect(200);
    assert.equal(all.headers['x-total-count'], '1');
    const row = all.body[0];
    assert.equal(row.id, requestId);
    assert.equal(row.status, 'PENDING');
    assert.equal(row.organizationName, `E2E lgpd ${stamp}`);
    assert.equal(row.userEmail, `mestre-${stamp}${DOMAIN}`);

    const today = new Date().toISOString().slice(0, 10);
    const inRange = await http().get(`/api/data-deletion-requests?organizationId=${orgId}&status=PENDING&from=${today}&to=${today}`).set(auth(superToken)).expect(200);
    assert.equal(inRange.body.length, 1);
    const otherStatus = await http().get(`/api/data-deletion-requests?organizationId=${orgId}&status=DONE`).set(auth(superToken)).expect(200);
    assert.equal(otherStatus.body.length, 0);
    const past = await http().get(`/api/data-deletion-requests?organizationId=${orgId}&to=2000-01-01`).set(auth(superToken)).expect(200);
    assert.equal(past.body.length, 0);

    await http().get('/api/data-deletion-requests').set(auth(mestreToken)).expect(403); // MEMBER nao ve
    await http().get('/api/data-deletion-requests?status=QUALQUER').set(auth(superToken)).expect(400);
  });

  it('PATCH: IN_PROGRESS -> DONE grava data e nota, audita e NAO apaga nada; erros 400/403/404', async () => {
    const inProgress = await http().patch(`/api/data-deletion-requests/${requestId}`).set(auth(superToken)).send({ status: 'IN_PROGRESS' }).expect(200);
    assert.equal(inProgress.body.status, 'IN_PROGRESS');
    assert.equal(inProgress.body.resolvedAt, null);

    const done = await http()
      .patch(`/api/data-deletion-requests/${requestId}`)
      .set(auth(superToken))
      .send({ status: 'DONE', note: 'Anonimizado manualmente conforme o procedimento.' })
      .expect(200);
    assert.equal(done.body.status, 'DONE');
    assert.ok(done.body.resolvedAt);
    assert.equal(done.body.resolutionNote, 'Anonimizado manualmente conforme o procedimento.');
    assert.ok(await prisma.user.findUnique({ where: { id: userId } }), 'DONE nao apaga o usuario');
    assert.ok(await prisma.organization.findUnique({ where: { id: orgId } }), 'DONE nao apaga o grupo');
    const audits = await prisma.auditLog.findMany({ where: { action: 'DATA_DELETION_REQUEST_UPDATE', resourceId: String(requestId) }, orderBy: { id: 'asc' } });
    assert.equal(audits.length, 2);
    assert.deepEqual((audits[1].metadata as Record<string, unknown>).to, 'DONE');

    await http().patch(`/api/data-deletion-requests/${requestId}`).set(auth(plainToken)).send({ status: 'DONE' }).expect(403); // so' super admin
    await http().patch(`/api/data-deletion-requests/${requestId}`).set(auth(mestreToken)).send({ status: 'DONE' }).expect(403);
    await http().patch(`/api/data-deletion-requests/${requestId}`).set(auth(superToken)).send({ status: 'RESOLVED' }).expect(400);
    await http().patch(`/api/data-deletion-requests/${requestId}`).set(auth(superToken)).send({ status: 'REJECTED' }).expect(400); // rejeitar exige nota
    await http().patch('/api/data-deletion-requests/999999999').set(auth(superToken)).send({ status: 'DONE' }).expect(404);
  });
});
