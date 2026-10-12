import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, loginAs } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';

/**
 * Comunicados: alcance por turma (classId) e por papel (audienceRole). Sempre combinados com uma turma da fixture
 * para que só os usuários da fixture recebam notificação (nenhum usuário do seed é tocado).
 */
describe('Comunicados: alcance por turma/papel (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let mestreToken: string;
  const announcementIds: number[] = [];
  let unitId: number | undefined;
  const TAG = `[e2e-reach] ${Date.now()}`;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'reach');
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { resource: 'announcement', resourceId: { in: announcementIds.map(String) } } });
    await prisma.announcement.deleteMany({ where: { id: { in: announcementIds } } });
    await fx.cleanup();
    if (unitId) await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.$disconnect();
    await app.close();
  });

  const publish = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).post('/api/announcements').set(auth(mestreToken)).send({ title: TAG, body: 'Recado', ...body });
    if (res.status === 201) announcementIds.push(res.body.id);
    return res;
  };
  const listTitles = async (token: string) => {
    const res = await request(app.getHttpServer()).get(`/api/announcements?q=${encodeURIComponent(TAG)}`).set(auth(token)).expect(200);
    return res.body as Array<{ id: number }>;
  };

  it('por turma: notifica e mostra só a quem está na turma (aluno + responsável); outros não veem nem por id', async () => {
    const res = await publish({ classId: fx.classMineId });
    assert.equal(res.status, 201);
    assert.equal(res.body.classId, fx.classMineId);

    for (const who of [fx.self, fx.guardian]) {
      assert.equal((await listTitles(who.token)).length, 1);
      assert.equal(await prisma.notification.count({ where: { userId: who.userId, type: 'ANNOUNCEMENT', title: TAG } }), 1);
    }
    assert.equal((await listTitles(fx.orphan.token)).length, 0);
    assert.equal(await prisma.notification.count({ where: { userId: fx.orphan.userId, title: TAG } }), 0);
    await request(app.getHttpServer()).get(`/api/announcements/${res.body.id}`).set(auth(fx.orphan.token)).expect(404);
    assert.equal((await listTitles(mestreToken)).length, 1, 'a equipe vê tudo');
  });

  it('por turma + papel: só o responsável da turma; turma alheia/inexistente => 400', async () => {
    const before = await prisma.notification.count({ where: { userId: fx.self.userId, title: `${TAG} pais` } });
    const res = await publish({ title: `${TAG} pais`, classId: fx.classMineId, audienceRole: 'RESPONSAVEL' });
    assert.equal(res.status, 201);
    assert.equal(await prisma.notification.count({ where: { userId: fx.guardian.userId, title: `${TAG} pais` } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: fx.self.userId, title: `${TAG} pais` } }), before);
    // o aluno (papel ALUNO) também não enxerga o comunicado dirigido aos responsáveis
    const seen = await request(app.getHttpServer()).get(`/api/announcements/${res.body.id}`).set(auth(fx.self.token));
    assert.equal(seen.status, 404);

    assert.equal((await publish({ classId: 999999999 })).status, 400);
    assert.equal((await publish({ stateUf: 'XX' })).status, 400);
  });
  it('por UF: só quem tem unidade naquele estado (combinado com a turma)', async () => {
    unitId = (await prisma.unit.create({ data: { organizationId: fx.organizationId, name: 'E2E reach unidade', state: 'GO' } })).id;
    await prisma.student.update({ where: { id: fx.self.studentId }, data: { unitId } });

    const goTitle = `${TAG} go`;
    const spTitle = `${TAG} sp`;
    const go = await publish({ title: goTitle, classId: fx.classMineId, stateUf: 'go' });
    assert.equal(go.status, 201);
    assert.equal(go.body.stateUf, 'GO');
    assert.equal(await prisma.notification.count({ where: { userId: fx.self.userId, title: goTitle } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: fx.guardian.userId, title: goTitle } }), 0, 'dependente sem unidade não é de GO');
    await request(app.getHttpServer()).get(`/api/announcements/${go.body.id}`).set(auth(fx.self.token)).expect(200);

    const sp = await publish({ title: spTitle, classId: fx.classMineId, stateUf: 'SP' });
    assert.equal(await prisma.notification.count({ where: { userId: fx.self.userId, title: spTitle } }), 0);
    await request(app.getHttpServer()).get(`/api/announcements/${sp.body.id}`).set(auth(fx.self.token)).expect(404);
  });
});
