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
  const RODA_IMAGE_URL = 'https://picsum.photos/seed/e2e-roda/400';
  const EVENT_IMAGE_URL = 'https://picsum.photos/seed/e2e-evento/400';

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
        imageUrl: RODA_IMAGE_URL,
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
        imageUrl: EVENT_IMAGE_URL,
      })
      .expect(201);
    publicEventId = res.body.id;

    const persisted = await prisma.event.findUniqueOrThrow({ where: { id: publicEventId } });
    assert.equal(persisted.type, 'WORKSHOP');
    assert.equal(persisted.stateId, stateId);
    assert.equal(persisted.cityId, cityId);
    assert.equal(persisted.isPublic, true);
    assert.equal(persisted.imageUrl, EVENT_IMAGE_URL);
  });

  it('POST /events com imageUrl inválida (não é URL) → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ title: '[e2e-test] Imagem inválida', date: eventDate, imageUrl: 'não-é-uma-url' })
      .expect(400);
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

  it('GET /calendar traz imageUrl de rodas e eventos (usado nos cards do feed)', async () => {
    const res = await request(app.getHttpServer()).get(`/api/calendar?stateId=${stateId}`).expect(200);
    const roda = res.body.find((i: { title: string }) => i.title === RODA_TITLE);
    const evento = res.body.find((i: { title: string }) => i.title === PUBLIC_EVENT_TITLE);
    assert.equal(roda.imageUrl, RODA_IMAGE_URL);
    assert.equal(evento.imageUrl, EVENT_IMAGE_URL);
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

/**
 * Calendário público com >100 itens: antes cada fonte (rodas/eventos) tinha `take: 100` fixo, sem
 * aviso nem página seguinte. Agora limit/offset (padrão 50, teto 200) + X-Total-Count, com a
 * fusão cronológica das duas tabelas determinística (data, origem, id) — provado contra a ordem
 * calculada via Prisma, inclusive com empates de data entre roda e evento.
 */
describe('Calendário — paginação com total real (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let organizationId: number;
  let stateId: number;
  let cityId: number;
  const suffix = `pg${Date.now()}`;
  const get = (qs: string) => request(app.getHttpServer()).get(`/api/calendar?stateId=${stateId}${qs}`);
  type Item = { id: number; source: 'RODA' | 'EVENTO'; type: string; date: string; title: string };

  before(async () => {
    app = await createTestApp();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MESTRE_EMAIL, password: DEV_PASSWORD })
      .expect(200);
    organizationId = login.body.user.organizationId;

    const state = await prisma.state.create({ data: { name: '[e2e] Estado Paginação', uf: `P${suffix}`.slice(0, 20) } });
    stateId = state.id;
    cityId = (await prisma.city.create({ data: { stateId, name: '[e2e] Cidade Paginação' } })).id;

    // 60 rodas + 45 eventos públicos (+5 privados que NÃO contam). Duas rodas por dia (datas
    // IGUAIS às dos eventos de mesmo índice => empates entre as fontes), a partir de amanhã.
    const at = (k: number) => new Date(Date.now() + (1 + Math.floor(k / 2)) * 24 * 60 * 60 * 1000 + 3_600_000);
    const stamp = (k: number) => {
      const d = at(k);
      d.setUTCMinutes(0, 0, 0);
      return d;
    };
    await prisma.roda.createMany({
      data: Array.from({ length: 60 }, (_, k) => ({
        organizationId,
        stateId,
        cityId,
        title: `${suffix} roda ${k}`,
        date: stamp(k),
      })),
    });
    await prisma.event.createMany({
      data: [
        ...Array.from({ length: 45 }, (_, k) => ({
          organizationId,
          stateId,
          cityId,
          title: `${suffix} evento ${k}`,
          type: k % 2 === 0 ? 'WORKSHOP' : 'BATIZADO',
          isPublic: true,
          date: stamp(k),
        })),
        ...Array.from({ length: 5 }, (_, k) => ({
          organizationId,
          stateId,
          cityId,
          title: `${suffix} privado ${k}`,
          type: 'WORKSHOP',
          isPublic: false,
          date: stamp(k),
        })),
      ],
    });
  });

  after(async () => {
    await prisma.roda.deleteMany({ where: { stateId } });
    await prisma.event.deleteMany({ where: { stateId } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    await prisma.$disconnect();
    await app.close();
  });

  /** Ordem esperada calculada à parte (Prisma + comparador): data, EVENTO antes de RODA, id. */
  const expectedOrder = async (): Promise<string[]> => {
    const [rodas, events] = await Promise.all([
      prisma.roda.findMany({ where: { stateId } }),
      prisma.event.findMany({ where: { stateId, isPublic: true } }),
    ]);
    return [
      ...rodas.map((r) => ({ key: `RODA-${r.id}`, t: r.date.getTime(), rank: 1, id: r.id })),
      ...events.map((e) => ({ key: `EVENTO-${e.id}`, t: e.date.getTime(), rank: 0, id: e.id })),
    ]
      .sort((a, b) => a.t - b.t || a.rank - b.rank || a.id - b.id)
      .map((x) => x.key);
  };
  const keys = (items: Item[]) => items.map((i) => `${i.source}-${i.id}`);

  it('105 itens públicos: sem limit vêm 50 (array) e X-Total-Count = 105 (privados não contam; antes o teto era 100 por fonte, sem aviso)', async () => {
    const res = await get('').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    assert.equal(res.headers['x-total-count'], '105');
  });

  it('páginas consecutivas reconstroem exatamente a ordem cronológica esperada, sem repetir nem perder (inclui empates roda/evento)', async () => {
    const expected = await expectedOrder();
    assert.equal(expected.length, 105);
    const p1 = await get('&limit=50&offset=0').expect(200);
    const p2 = await get('&limit=50&offset=50').expect(200);
    const p3 = await get('&limit=50&offset=100').expect(200);
    assert.deepEqual([p1.body.length, p2.body.length, p3.body.length], [50, 50, 5]);
    const all = [...keys(p1.body), ...keys(p2.body), ...keys(p3.body)];
    assert.deepEqual(all, expected);
    assert.equal(new Set(all).size, 105);

    const mid = await get('&limit=40&offset=30').expect(200); // fatia que atravessa as duas fontes
    assert.deepEqual(keys(mid.body), expected.slice(30, 70));
    const big = await get('&limit=200').expect(200);
    assert.deepEqual(keys(big.body), expected);
    const beyond = await get('&offset=500').expect(200);
    assert.deepEqual(beyond.body, []);
    assert.equal(beyond.headers['x-total-count'], '105');
  });

  it('o total acompanha o filtro de tipo (RODA = 60; WORKSHOP = 23 públicos, sem os 5 privados)', async () => {
    const rodas = await get('&type=RODA&limit=200').expect(200);
    assert.equal(rodas.headers['x-total-count'], '60');
    assert.equal(rodas.body.length, 60);
    assert.ok(rodas.body.every((i: Item) => i.source === 'RODA'));
    const workshop = await get('&type=WORKSHOP&limit=200').expect(200);
    assert.equal(workshop.headers['x-total-count'], '23');
    assert.ok(workshop.body.every((i: Item) => i.type === 'WORKSHOP' && i.source === 'EVENTO'));
    const first = await get('&type=WORKSHOP&limit=10&offset=20').expect(200);
    assert.equal(first.body.length, 3);
  });

  it('limit/offset inválidos => 400 (limit=0/201/abc/1.5, offset=-1/10001); limit=200 e offset=10000 passam; rota segue pública', async () => {
    for (const qs of ['limit=0', 'limit=201', 'limit=abc', 'limit=1.5', 'offset=-1', 'offset=10001', 'offset=x']) {
      await get(`&${qs}`).expect(400);
    }
    await get('&limit=200&offset=10000').expect(200);
    await get('&scope=ano').expect(400); // validações antigas intactas
  });
});
