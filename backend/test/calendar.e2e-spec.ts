import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { MeFixture, createMeFixture } from './utils/me-fixtures';
import { SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';
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

/**
 * Calendário público com resumo de participação: cada item traz `participantsCount` (agregado,
 * sem dado pessoal) e `myParticipation` (`{ id, studentId, status } | null`), como GET /events e
 * GET /rodas, SEM N+1 (um groupBy + um findMany por ORIGEM e por página). @OptionalAuth: anônimo
 * e token inválido => myParticipation null (nunca 401). RODA considera o usuário do token;
 * EVENTO considera o aluno próprio (prioridade) e os dependentes, em QUALQUER organização (o
 * feed mistura grupos). Nenhum nome de terceiro vaza.
 */
describe('Calendário — participantsCount e myParticipation (e2e)', () => {
  const TAG = `CALP${Date.now()}`;
  let app: INestApplication;
  let prismaSvc: PrismaService;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let stateId: number;
  let cityId: number;
  let depBId: number; // aluno da organização B de quem o RESPONSAVEL é responsável
  let extraDepId: number; // 2º dependente do ALUNO "self" (prova a prioridade do próprio aluno)
  const ids = {
    roda1: 0, roda2: 0, ev1: 0, ev2B: 0, ev3: 0, evPrivate: 0,
    rodaSelf: 0, rodaMestre: 0, evSelf: 0, evExtra: 0, evGuest: 0, evStranger: 0, evB: 0,
  };
  const GUEST = `Convidado Sentinela ${TAG}`;
  const get = (qs: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/api/calendar?stateId=${stateId}${qs}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  type Row = {
    id: number; source: 'RODA' | 'EVENTO'; title: string; participantsCount: number;
    myParticipation: { id: number; studentId: number | null; status: string } | null;
  };
  const row = (body: Row[], source: 'RODA' | 'EVENTO', id: number) => {
    const found = body.find((r) => r.source === source && r.id === id);
    assert.ok(found, `${source}-${id} ausente do calendário`);
    return found;
  };

  before(async () => {
    app = await createTestApp();
    prismaSvc = app.get(PrismaService);
    fx = await createMeFixture(app, prisma, 'calp');
    mestre = await loginAs(app, MESTRE_EMAIL);
    orgB = await createSecondOrg(app, prisma, 'calp');
    const state = await prisma.state.create({ data: { name: `${TAG} UF`, uf: `C${String(Date.now()).slice(-8)}` } });
    stateId = state.id;
    cityId = (await prisma.city.create({ data: { stateId, name: `${TAG} Cidade` } })).id;

    const org = fx.organizationId;
    const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
    const loc = { stateId, cityId };
    ids.roda1 = (await prisma.roda.create({ data: { organizationId: org, title: `${TAG} roda 1`, date: day(2), ...loc } })).id;
    ids.roda2 = (await prisma.roda.create({ data: { organizationId: org, title: `${TAG} roda 2`, date: day(3), ...loc } })).id;
    ids.ev1 = (await prisma.event.create({ data: { organizationId: org, title: `${TAG} evento 1`, date: day(4), isPublic: true, ...loc } })).id;
    ids.ev2B = (await prisma.event.create({ data: { organizationId: orgB.organizationId, title: `${TAG} evento orgB`, date: day(5), isPublic: true, ...loc } })).id;
    ids.ev3 = (await prisma.event.create({ data: { organizationId: org, title: `${TAG} evento 3`, date: day(6), isPublic: true, ...loc } })).id;
    ids.evPrivate = (await prisma.event.create({ data: { organizationId: org, title: `${TAG} privado`, date: day(7), isPublic: false, ...loc } })).id;

    depBId = (await prisma.student.create({ data: { organizationId: orgB.organizationId, name: `${TAG} Dependente OrgB` } })).id;
    await prisma.studentGuardian.create({ data: { organizationId: orgB.organizationId, studentId: depBId, userId: fx.guardian.userId, name: `${TAG} resp B` } });
    extraDepId = (await prisma.student.create({ data: { organizationId: org, name: `${TAG} Segundo dependente` } })).id;
    await prisma.studentGuardian.create({ data: { organizationId: org, studentId: extraDepId, userId: fx.self.userId, name: `${TAG} resp extra` } });

    // RODA 1: ALUNO (self) + MESTRE. RODA 2: ninguém.
    ids.rodaSelf = (await prisma.rodaParticipant.create({ data: { rodaId: ids.roda1, userId: fx.self.userId } })).id;
    ids.rodaMestre = (await prisma.rodaParticipant.create({ data: { rodaId: ids.roda1, userId: mestre.userId, status: 'INVITED' } })).id;
    // EVENTO 1: o dependente extra (criado ANTES, id menor) + o aluno self + um aluno alheio + um
    // convidado + o dependente do RESPONSAVEL => 5. EVENTO orgB: o dependente de lá. Privado: 1.
    ids.evExtra = (await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.ev1, studentId: extraDepId } })).id;
    ids.evSelf = (await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.ev1, studentId: fx.self.studentId, status: 'ATTENDED' } })).id;
    ids.evStranger = (await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.ev1, studentId: fx.strangerId } })).id;
    ids.evGuest = (await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.ev1, guestName: GUEST } })).id;
    await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.ev1, studentId: fx.guardian.dependentId } });
    ids.evB = (await prisma.eventParticipant.create({ data: { organizationId: orgB.organizationId, eventId: ids.ev2B, studentId: depBId } })).id;
    await prisma.eventParticipant.create({ data: { organizationId: org, eventId: ids.evPrivate, studentId: fx.self.studentId } });
  });

  after(async () => {
    const eventIds = [ids.ev1, ids.ev2B, ids.ev3, ids.evPrivate];
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.rodaParticipant.deleteMany({ where: { rodaId: { in: [ids.roda1, ids.roda2] } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.roda.deleteMany({ where: { id: { in: [ids.roda1, ids.roda2] } } });
    await prisma.studentGuardian.deleteMany({ where: { studentId: { in: [depBId, extraDepId] } } });
    await prisma.student.deleteMany({ where: { id: { in: [depBId, extraDepId] } } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.state.deleteMany({ where: { id: stateId } });
    await fx.cleanup();
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('anônimo: participantsCount agregado, myParticipation null em tudo, privado fora, nenhum nome/id pessoal; campos antigos e contrato preservados', async () => {
    const res = await get('&limit=200').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.headers['x-total-count'], '5'); // 2 rodas + 3 eventos públicos (o privado não conta)
    assert.equal(res.body.length, 5);
    assert.deepEqual(res.body.map((r: Row) => `${r.source}-${r.id}`), [
      `RODA-${ids.roda1}`, `RODA-${ids.roda2}`, `EVENTO-${ids.ev1}`, `EVENTO-${ids.ev2B}`, `EVENTO-${ids.ev3}`,
    ]); // ordem cronológica determinística
    const counts = Object.fromEntries(res.body.map((r: Row) => [`${r.source}-${r.id}`, r.participantsCount]));
    assert.deepEqual(counts, {
      [`RODA-${ids.roda1}`]: 2, [`RODA-${ids.roda2}`]: 0,
      [`EVENTO-${ids.ev1}`]: 5, [`EVENTO-${ids.ev2B}`]: 1, [`EVENTO-${ids.ev3}`]: 0,
    });
    assert.ok(res.body.every((r: Row) => r.myParticipation === null));
    for (const field of ['id', 'source', 'type', 'title', 'description', 'date', 'location', 'imageUrl', 'state', 'city']) {
      assert.ok(res.body.every((r: object) => field in r), `campo ${field} sumiu do calendário`);
    }
    for (const leak of [GUEST, `${TAG} Dependente OrgB`, `${TAG} Segundo dependente`, 'alheio', fx.self.token]) {
      assert.ok(!res.text.includes(leak), `vazou: ${leak}`);
    }
    // Nada de participante/ids pessoais soltos no item (só dentro de myParticipation, quando há).
    assert.ok(res.body.every((r: object) => !('participants' in r) && !('userId' in r) && !('studentId' in r)));
  });

  it('token inválido em rota pública não vira 401: segue anônimo (idêntico ao anônimo)', async () => {
    const anon = await get('&limit=200').expect(200);
    const bad = await get('&limit=200', 'token-invalido').expect(200);
    assert.deepEqual(bad.body, anon.body);
    assert.equal(bad.headers['x-total-count'], '5');
  });

  it('ALUNO: roda = a própria participação do usuário (não a do MESTRE); evento = o PRÓPRIO aluno tem prioridade sobre dependente; orgB/sem inscrição = null', async () => {
    const res = await get('&limit=200', fx.self.token).expect(200);
    assert.deepEqual(row(res.body, 'RODA', ids.roda1).myParticipation, { id: ids.rodaSelf, studentId: null, status: 'CONFIRMED' });
    assert.equal(row(res.body, 'RODA', ids.roda1).participantsCount, 2);
    assert.equal(row(res.body, 'RODA', ids.roda2).myParticipation, null);
    // evExtra (dependente do self) tem id MENOR que evSelf, mas o próprio aluno vem primeiro.
    assert.ok(ids.evExtra < ids.evSelf);
    assert.deepEqual(row(res.body, 'EVENTO', ids.ev1).myParticipation, { id: ids.evSelf, studentId: fx.self.studentId, status: 'ATTENDED' });
    assert.equal(row(res.body, 'EVENTO', ids.ev1).participantsCount, 5);
    assert.equal(row(res.body, 'EVENTO', ids.ev2B).myParticipation, null);
    assert.equal(row(res.body, 'EVENTO', ids.ev3).myParticipation, null);
    for (const leak of [GUEST, `${TAG} Dependente OrgB`, 'alheio']) assert.ok(!res.text.includes(leak), `vazou: ${leak}`);
  });

  it('RESPONSAVEL: evento do dependente é "seu" (inclusive de OUTRA organização); roda é só do usuário do token (null)', async () => {
    const res = await get('&limit=200', fx.guardian.token).expect(200);
    const ev1 = row(res.body, 'EVENTO', ids.ev1).myParticipation;
    assert.ok(ev1 && ev1.studentId === fx.guardian.dependentId && ev1.status === 'CONFIRMED');
    assert.deepEqual(row(res.body, 'EVENTO', ids.ev2B).myParticipation, { id: ids.evB, studentId: depBId, status: 'CONFIRMED' });
    assert.equal(row(res.body, 'EVENTO', ids.ev3).myParticipation, null);
    assert.ok(res.body.filter((r: Row) => r.source === 'RODA').every((r: Row) => r.myParticipation === null));
  });

  it('MESTRE: a própria roda (status INVITED) e nenhum evento; usuário de outro grupo não herda a participação de ninguém', async () => {
    const res = await get('&limit=200', mestre.token).expect(200);
    assert.deepEqual(row(res.body, 'RODA', ids.roda1).myParticipation, { id: ids.rodaMestre, studentId: null, status: 'INVITED' });
    assert.ok(res.body.filter((r: Row) => r.source === 'EVENTO').every((r: Row) => r.myParticipation === null));
    const other = await get('&limit=200', orgB.token).expect(200);
    assert.ok(other.body.every((r: Row) => r.myParticipation === null));
    assert.equal(row(other.body, 'EVENTO', ids.ev1).participantsCount, 5); // agregado é público
  });

  it('páginas pequenas atravessando as duas fontes recompõem exatamente o resultado completo (resumo sempre da origem certa)', async () => {
    const full = await get('&limit=200', fx.guardian.token).expect(200);
    const parts: Row[] = [];
    for (const offset of [0, 2, 4]) parts.push(...(await get(`&limit=2&offset=${offset}`, fx.guardian.token).expect(200)).body);
    assert.deepEqual(parts, full.body);
    const filtered = await get('&type=RODA&limit=200', fx.self.token).expect(200);
    assert.ok(filtered.body.every((r: Row) => r.source === 'RODA'));
    assert.equal(filtered.headers['x-total-count'], '2');
    assert.equal(row(filtered.body, 'RODA', ids.roda1).myParticipation?.id, ids.rodaSelf);
    assert.equal((await get('&type=WORKSHOP', fx.self.token).expect(200)).body.length, 0);
  });

  it('sem N+1: UMA agregação (groupBy) e UMA busca de "minhas" por origem por página — independente do número de itens', async () => {
    type Delegate = { groupBy: (...a: unknown[]) => unknown; findMany: (...a: unknown[]) => unknown };
    const counts = { eventGroupBy: 0, eventFindMany: 0, rodaGroupBy: 0, rodaFindMany: 0 };
    const patch = (delegate: Delegate, group: keyof typeof counts, find: keyof typeof counts) => {
      const { groupBy, findMany } = delegate;
      delegate.groupBy = (...a: unknown[]) => (counts[group]++, groupBy.apply(delegate, a));
      delegate.findMany = (...a: unknown[]) => (counts[find]++, findMany.apply(delegate, a));
      return () => Object.assign(delegate, { groupBy, findMany });
    };
    const restoreEvent = patch(prismaSvc.eventParticipant as unknown as Delegate, 'eventGroupBy', 'eventFindMany');
    const restoreRoda = patch(prismaSvc.rodaParticipant as unknown as Delegate, 'rodaGroupBy', 'rodaFindMany');
    try {
      const res = await get('&limit=200', fx.self.token).expect(200);
      assert.equal(res.body.length, 5);
      assert.deepEqual(counts, { eventGroupBy: 1, eventFindMany: 1, rodaGroupBy: 1, rodaFindMany: 1 });
      // Anônimo: só as agregações (não há "minhas" para buscar).
      Object.assign(counts, { eventGroupBy: 0, eventFindMany: 0, rodaGroupBy: 0, rodaFindMany: 0 });
      await get('&limit=200').expect(200);
      assert.deepEqual(counts, { eventGroupBy: 1, eventFindMany: 0, rodaGroupBy: 1, rodaFindMany: 0 });
    } finally {
      restoreEvent();
      restoreRoda();
    }
  });
});
