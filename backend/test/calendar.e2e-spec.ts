import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Calendário da capoeira (src/interface/http/calendar/), última peça da Jornada do Capoeirista
 * — PLANO_PROJETO.md §10.17. Agrega Roda (pública desde a fundação) + Event com `isPublic=true`
 * de QUALQUER organização, filtrável por estado/cidade/tipo/período. Também cobre os campos
 * novos de Event (`type`, `stateId`, `cityId`) usados nesse filtro.
 *
 * Cria um Estado/Cidade isolados desta suíte (uf sintética, nunca colide com o "GO"/"Goiânia"
 * do seed) para poder filtrar com certeza — nunca reaproveita a Roda do seed para não depender
 * de quantidade exata num Postgres compartilhado entre suítes.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';

describe('Calendário da capoeira (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let organizationId: number;
  let stateId: number;
  let cityId: number;
  let rodaId: number;
  let publicEventId: number;
  let privateEventId: number;

  const suffix = Date.now();
  const RODA_TITLE = `[e2e-test] Calendário Roda ${suffix}`;
  const PUBLIC_EVENT_TITLE = `[e2e-test] Calendário Workshop ${suffix}`;
  const PRIVATE_EVENT_TITLE = `[e2e-test] Calendário Privado ${suffix}`;
  const eventDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  before(async () => {
    app = await createTestApp();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    mestreToken = login.body.accessToken;
    organizationId = login.body.user.organizationId;

    const state = await prisma.state.create({ data: { name: '[e2e] Estado Teste', uf: `E2${suffix}` } });
    stateId = state.id;
    const city = await prisma.city.create({ data: { stateId, name: '[e2e] Cidade Teste' } });
    cityId = city.id;

    const roda = await prisma.roda.create({
      data: {
        organizationId,
        stateId,
        cityId,
        title: RODA_TITLE,
        date: new Date(eventDate),
        location: 'Praça de teste',
      },
    });
    rodaId = roda.id;
  });

  after(async () => {
    await prisma.rodaParticipant.deleteMany({ where: { rodaId } });
    await prisma.roda.deleteMany({ where: { id: rodaId } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: [publicEventId, privateEventId].filter(Boolean) } } });
    await prisma.event.deleteMany({ where: { title: { in: [PUBLIC_EVENT_TITLE, PRIVATE_EVENT_TITLE] } } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /events com type/stateId/cityId válidos cria um evento público, confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        title: PUBLIC_EVENT_TITLE,
        date: eventDate,
        location: 'Ginásio de teste',
        isPublic: true,
        type: 'WORKSHOP',
        stateId,
        cityId,
      })
      .expect(201);
    publicEventId = res.body.id;

    const persisted = await prisma.event.findUniqueOrThrow({ where: { id: publicEventId } });
    assert.equal(persisted.type, 'WORKSHOP');
    assert.equal(persisted.stateId, stateId);
    assert.equal(persisted.cityId, cityId);
    assert.equal(persisted.isPublic, true);
  });

  it('POST /events sem type usa o default OUTRO', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ title: PRIVATE_EVENT_TITLE, date: eventDate, isPublic: false })
      .expect(201);
    privateEventId = res.body.id;

    const persisted = await prisma.event.findUniqueOrThrow({ where: { id: privateEventId } });
    assert.equal(persisted.type, 'OUTRO');
    assert.equal(persisted.isPublic, false);
  });

  it('POST /events com stateId inexistente → 400, nada gravado', async () => {
    const beforeCount = await prisma.event.count();
    await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ title: '[e2e-test] Não deveria existir', date: eventDate, stateId: 999999 })
      .expect(400);
    assert.equal(await prisma.event.count(), beforeCount);
  });

  it('GET /calendar SEM token inclui a roda e o evento público, mas NÃO o evento privado', async () => {
    const res = await request(app.getHttpServer()).get('/api/calendar').expect(200);

    assert.ok(res.body.some((i: { source: string; title: string }) => i.source === 'RODA' && i.title === RODA_TITLE));
    assert.ok(
      res.body.some((i: { source: string; title: string }) => i.source === 'EVENTO' && i.title === PUBLIC_EVENT_TITLE),
    );
    assert.ok(!res.body.some((i: { title: string }) => i.title === PRIVATE_EVENT_TITLE));
  });

  it('GET /calendar?type=RODA só traz rodas', async () => {
    const res = await request(app.getHttpServer()).get('/api/calendar?type=RODA').expect(200);
    assert.ok(res.body.some((i: { title: string }) => i.title === RODA_TITLE));
    assert.ok(!res.body.some((i: { title: string }) => i.title === PUBLIC_EVENT_TITLE));
    assert.ok(res.body.every((i: { source: string }) => i.source === 'RODA'));
  });

  it('GET /calendar?type=WORKSHOP só traz eventos desse tipo', async () => {
    const res = await request(app.getHttpServer()).get('/api/calendar?type=WORKSHOP').expect(200);
    assert.ok(res.body.some((i: { title: string }) => i.title === PUBLIC_EVENT_TITLE));
    assert.ok(!res.body.some((i: { title: string }) => i.title === RODA_TITLE));
    assert.ok(res.body.every((i: { type: string }) => i.type === 'WORKSHOP'));
  });

  it('GET /calendar?stateId=X isola pelo estado de teste (só a roda e o evento criados aqui)', async () => {
    const res = await request(app.getHttpServer()).get(`/api/calendar?stateId=${stateId}`).expect(200);
    assert.equal(res.body.length, 2);
    const titles = res.body.map((i: { title: string }) => i.title).sort();
    assert.deepEqual(titles, [PUBLIC_EVENT_TITLE, RODA_TITLE].sort());
  });

  it('GET /calendar?scope=today não inclui itens daqui a 3 dias', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/calendar?stateId=${stateId}&scope=today`)
      .expect(200);
    assert.equal(res.body.length, 0);
  });

  it('GET /calendar?scope=inválido → 400', async () => {
    await request(app.getHttpServer()).get('/api/calendar?scope=ano').expect(400);
  });

  it('GET /calendar?type=inválido → 400', async () => {
    await request(app.getHttpServer()).get('/api/calendar?type=FEIJOADA').expect(400);
  });
});
