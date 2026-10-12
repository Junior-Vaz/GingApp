import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { GeocodingService } from '../src/shared/geo/geocoding.service';
import { ALUNO_EMAIL, createSecondOrg, loginAs, MESTRE_EMAIL, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Mapa da comunidade (GET /map/places, /map/config, POST /map/geocode) + latitude/longitude em unidade/evento/roda.
 * Grupo "B" = org de fixture com dados proprios (coordenadas em Sao Paulo e Rio); quem consulta e' o seed ginga-brasil
 * (grupo "A", que nao tem coordenadas e nunca e' tocado) e o proprio Mestre de B. Segunda via independente = Prisma direto.
 * Nenhum acesso de rede: o Google e' um fetch falso injetado no GeocodingService.
 */
const TAG = `${Date.now()}`;
const SP = { latitude: -23.5505, longitude: -46.6333 };
const SP_EVENT = { latitude: -23.561, longitude: -46.655 };
const RIO = { latitude: -22.9068, longitude: -43.1729 };
const DAY = 86_400_000;

describe('Mapa da comunidade (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  let orgB: SecondOrg;
  let mestreAToken: string;
  let alunoAToken: string;
  const savedEnv: Record<string, string | undefined> = {};
  let geocoding: GeocodingService;

  const places = (token: string | undefined, query = '') => {
    const req = request(server()).get(`/api/map/places${query ? `?${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const mine = (items: Array<{ organization: { id: number } | null }>) =>
    items.filter((item) => item.organization?.id === orgB.organizationId);
  const idsOf = (items: Array<{ id: string }>) => items.map((i) => i.id);
  const setMapVisible = (value: boolean) =>
    request(server())
      .patch('/api/organizations/me')
      .set('Authorization', `Bearer ${orgB.token}`)
      .send({ mapVisible: value });

  let unitId: number;
  let classId: number;
  let publicEventId: number;
  let privateEventId: number;
  let cancelledEventId: number;
  let oldEventId: number;
  let rodaId: number;

  before(async () => {
    for (const key of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_MAPS_MAP_ID']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    app = await createTestApp();
    geocoding = app.get(GeocodingService);
    mestreAToken = (await loginAs(app, MESTRE_EMAIL)).token;
    alunoAToken = (await loginAs(app, ALUNO_EMAIL)).token;
    orgB = await createSecondOrg(app, prisma, 'map');
    await prisma.organization.update({
      where: { id: orgB.organizationId },
      data: { name: `E2E Mapa ${TAG}`, description: `Grupo de teste do mapa ${'x'.repeat(300)}`, logo: 'https://cdn.example.com/logo.png' },
    });

    const unit = await prisma.unit.create({
      data: { organizationId: orgB.organizationId, name: 'Matriz', address: 'Rua A, 1', city: 'Sao Paulo', state: 'SP', isMain: true, ...SP },
    });
    unitId = unit.id;
    const turma = await prisma.class.create({
      data: { organizationId: orgB.organizationId, unitId, name: `Turma Mapa ${TAG}`, weekday: 3, startTime: '19:00', endTime: '20:30' },
    });
    classId = turma.id;
    const base = { organizationId: orgB.organizationId, type: 'OUTRO' };
    publicEventId = (
      await prisma.event.create({ data: { ...base, title: `Batizado Mapa ${TAG}`, date: new Date(Date.now() + 3 * DAY), isPublic: true, location: 'Ginasio X', capacity: 2, ...SP_EVENT } })
    ).id;
    privateEventId = (
      await prisma.event.create({ data: { ...base, title: `Reuniao Privada ${TAG}`, date: new Date(Date.now() + 3 * DAY), isPublic: false, ...SP_EVENT } })
    ).id;
    cancelledEventId = (
      await prisma.event.create({ data: { ...base, title: `Cancelado ${TAG}`, date: new Date(Date.now() + 3 * DAY), isPublic: true, status: 'CANCELLED', ...SP_EVENT } })
    ).id;
    oldEventId = (
      await prisma.event.create({ data: { ...base, title: `Antigo ${TAG}`, date: new Date(Date.now() - 90 * DAY), isPublic: true, ...SP_EVENT } })
    ).id;
    rodaId = (
      await prisma.roda.create({ data: { organizationId: orgB.organizationId, title: `Roda Rio ${TAG}`, date: new Date(Date.now() + 5 * DAY), location: 'Aterro', ...RIO } })
    ).id;
  });

  after(async () => {
    const orgId = orgB.organizationId;
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.roda.deleteMany({ where: { organizationId: orgId } });
    await prisma.event.deleteMany({ where: { organizationId: orgId } });
    await prisma.class.deleteMany({ where: { organizationId: orgId } });
    await prisma.unit.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('GET /map/config e POST /map/geocode', () => {
    it('sem token: 401 nas tres rotas', async () => {
      await request(server()).get('/api/map/config').expect(401);
      await places(undefined).expect(401);
      await request(server()).post('/api/map/geocode').send({ query: 'Rua X' }).expect(401);
    });

    it('sem chave: enabled=false, apiKey/mapId nulos e geocodingEnabled=false', async () => {
      const res = await request(server()).get('/api/map/config').set('Authorization', `Bearer ${alunoAToken}`).expect(200);
      assert.deepEqual(res.body, { enabled: false, apiKey: null, mapId: null, geocodingEnabled: false });
    });

    it('com GOOGLE_MAPS_API_KEY: devolve a chave de NAVEGADOR e o mapId; a chave de servidor nunca aparece', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'browser-key-123';
      process.env.GOOGLE_MAPS_MAP_ID = 'map-id-9';
      process.env.GOOGLE_MAPS_SERVER_KEY = 'server-secret-456';
      try {
        const res = await request(server()).get('/api/map/config').set('Authorization', `Bearer ${alunoAToken}`).expect(200);
        assert.deepEqual(res.body, { enabled: true, apiKey: 'browser-key-123', mapId: 'map-id-9', geocodingEnabled: true });
        assert.ok(!JSON.stringify(res.body).includes('server-secret-456'));
      } finally {
        for (const key of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_MAP_ID', 'GOOGLE_MAPS_SERVER_KEY']) delete process.env[key];
      }
    });

    it('geocode sem chave de servidor: 404 claro (sem erro 500)', async () => {
      const res = await request(server())
        .post('/api/map/geocode')
        .set('Authorization', `Bearer ${mestreAToken}`)
        .send({ query: 'Rua Sete, 450, Goiania' })
        .expect(404);
      assert.match(res.body.message, /indispon/i);
    });

    it('geocode: query curta/ausente = 400; ALUNO = 403; com chave (fetch falso) devolve latitude/longitude e nao vaza a chave', async () => {
      await request(server()).post('/api/map/geocode').set('Authorization', `Bearer ${mestreAToken}`).send({ query: 'ab' }).expect(400);
      await request(server()).post('/api/map/geocode').set('Authorization', `Bearer ${mestreAToken}`).send({}).expect(400);
      await request(server()).post('/api/map/geocode').set('Authorization', `Bearer ${alunoAToken}`).send({ query: 'Rua Sete, 450' }).expect(403);

      process.env.GOOGLE_MAPS_SERVER_KEY = 'server-secret-456';
      const urls: string[] = [];
      const previous = geocoding.fetchImpl;
      geocoding.fetchImpl = async (url) => {
        urls.push(url);
        return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: -16.6799, lng: -49.255 } } }] }) };
      };
      try {
        const res = await request(server())
          .post('/api/map/geocode')
          .set('Authorization', `Bearer ${mestreAToken}`)
          .send({ query: 'Praca Civica, Goiania' })
          .expect(200);
        assert.deepEqual(res.body, { latitude: -16.6799, longitude: -49.255 });
        assert.equal(urls.length, 1);
        assert.match(urls[0], /address=Praca\+Civica/);

        geocoding.fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) });
        await request(server()).post('/api/map/geocode').set('Authorization', `Bearer ${mestreAToken}`).send({ query: 'Lugar nenhum xyz' }).expect(404);
        geocoding.fetchImpl = async () => {
          throw new Error('rede caiu');
        };
        await request(server()).post('/api/map/geocode').set('Authorization', `Bearer ${mestreAToken}`).send({ query: 'Rua Sete, 450' }).expect(404);
      } finally {
        geocoding.fetchImpl = previous;
        delete process.env.GOOGLE_MAPS_SERVER_KEY;
      }
    });
  });

  describe('GET /map/places', () => {
    it('feliz: outro grupo ve unidade, treino, evento publico e roda de B (e NAO o evento privado, cancelado ou antigo), com o contrato exato', async () => {
      const res = await places(mestreAToken).expect(200);
      assert.equal(res.headers['cache-control'], 'private, max-age=30');
      const items = mine(res.body.items);
      assert.deepEqual(idsOf(items).sort(), [`CLASS:${classId}`, `EVENT:${publicEventId}`, `RODA:${rodaId}`, `UNIT:${unitId}`].sort());
      assert.ok(res.body.total >= items.length);
      assert.equal(Number(res.headers['x-total-count']), res.body.total);

      const unit = items.find((i: { id: string }) => i.id === `UNIT:${unitId}`);
      assert.deepEqual(Object.keys(unit).sort(), [
        'address', 'capacity', 'city', 'description', 'distanceKm', 'endTime', 'endsAt', 'id', 'imageUrl', 'isMine', 'latitude', 'longitude',
        'organization', 'spotsLeft', 'startTime', 'startsAt', 'state', 'title', 'type', 'unitName', 'weekday',
      ]);
      assert.equal(unit.type, 'UNIT');
      assert.equal(unit.title, `E2E Mapa ${TAG}`); // matriz = nome do grupo
      assert.equal(unit.latitude, SP.latitude);
      assert.equal(unit.longitude, SP.longitude);
      assert.equal(unit.address, 'Rua A, 1');
      assert.equal(unit.city, 'Sao Paulo');
      assert.equal(unit.state, 'SP');
      assert.equal(unit.isMine, false);
      assert.equal(unit.distanceKm, null);
      assert.ok(unit.description.length <= 240, 'descricao curta (<= 240)');
      assert.deepEqual(unit.organization, {
        id: orgB.organizationId,
        name: `E2E Mapa ${TAG}`,
        slug: unit.organization.slug,
        logoUrl: 'https://cdn.example.com/logo.png',
        description: unit.organization.description,
      });
      assert.ok(unit.organization.description.length <= 240);

      const treino = items.find((i: { id: string }) => i.id === `CLASS:${classId}`);
      assert.equal(treino.title, `Turma Mapa ${TAG}`);
      assert.equal(treino.weekday, 3);
      assert.equal(treino.startTime, '19:00');
      assert.equal(treino.endTime, '20:30');
      assert.equal(treino.latitude, SP.latitude); // coordenadas da unidade

      const evento = items.find((i: { id: string }) => i.id === `EVENT:${publicEventId}`);
      assert.equal(evento.title, `Batizado Mapa ${TAG}`);
      assert.equal(evento.address, 'Ginasio X');
      assert.equal(new Date(evento.startsAt).getTime() > Date.now(), true);
      assert.equal(evento.latitude, SP_EVENT.latitude);
      assert.equal(evento.capacity, 2);
      assert.equal(evento.spotsLeft, 2, 'evento com capacidade 2 e ninguem inscrito');
      assert.equal(unit.spotsLeft, null);

      const roda = items.find((i: { id: string }) => i.id === `RODA:${rodaId}`);
      assert.equal(roda.longitude, RIO.longitude);
      assert.ok(!idsOf(res.body.items).some((id: string) => [`EVENT:${privateEventId}`, `EVENT:${cancelledEventId}`, `EVENT:${oldEventId}`].includes(id)));
    });

    it('o proprio grupo ve tambem o evento privado dele e isMine=true; ALUNO de A tambem consulta', async () => {
      const own = await places(orgB.token).expect(200);
      assert.ok(idsOf(own.body.items).includes(`EVENT:${privateEventId}`));
      assert.ok(mine(own.body.items).every((i: { isMine: boolean }) => i.isMine === true));
      const aluno = await places(alunoAToken).expect(200);
      assert.ok(idsOf(aluno.body.items).includes(`UNIT:${unitId}`));
      assert.ok(!idsOf(aluno.body.items).includes(`EVENT:${privateEventId}`));
    });

    it('nao vaza dado privado: nenhum e-mail, telefone, professor ou aluno no JSON', async () => {
      const res = await places(mestreAToken, 'limit=1000').expect(200);
      const text = JSON.stringify(res.body);
      assert.ok(!/@/.test(text), 'sem e-mail');
      assert.ok(!/phone|email|document|teacher|student|password|paymentInstructions|history/i.test(text));
    });

    it('filtro por tipo (types), busca (q) e validacoes', async () => {
      const onlyUnits = await places(mestreAToken, 'types=UNIT').expect(200);
      assert.ok(onlyUnits.body.items.length > 0);
      assert.ok(onlyUnits.body.items.every((i: { type: string }) => i.type === 'UNIT'));
      const two = await places(mestreAToken, 'types=roda,class').expect(200);
      assert.deepEqual([...new Set(two.body.items.map((i: { type: string }) => i.type))].sort(), ['CLASS', 'RODA']);
      const found = await places(mestreAToken, `q=${encodeURIComponent(`Roda Rio ${TAG}`)}`).expect(200);
      assert.deepEqual(idsOf(found.body.items), [`RODA:${rodaId}`]);
      assert.equal(found.body.total, 1);

      await places(mestreAToken, 'types=UNIT,FOO').expect(400);
      await places(mestreAToken, 'radiusKm=10').expect(400);
      await places(mestreAToken, 'lat=-23.5').expect(400);
      await places(mestreAToken, 'lat=91&lng=0').expect(400);
      await places(mestreAToken, 'limit=1001').expect(400);
      await places(mestreAToken, 'foo=1').expect(400); // forbidNonWhitelisted
    });

    it('lat/lng + radiusKm (haversine): Sao Paulo ate 50 km exclui a roda do Rio; distanceKm ordenado; limit corta mas total conta tudo', async () => {
      const near = await places(mestreAToken, `lat=${SP.latitude}&lng=${SP.longitude}&radiusKm=50`).expect(200);
      const ids = idsOf(near.body.items);
      assert.ok(ids.includes(`UNIT:${unitId}`) && ids.includes(`EVENT:${publicEventId}`));
      assert.ok(!ids.includes(`RODA:${rodaId}`));
      const distances = near.body.items.map((i: { distanceKm: number }) => i.distanceKm);
      assert.ok(distances.every((d: unknown) => typeof d === 'number' && (d as number) <= 50));
      assert.deepEqual([...distances].sort((a: number, b: number) => a - b), distances);
      const unit = near.body.items.find((i: { id: string }) => i.id === `UNIT:${unitId}`);
      assert.equal(unit.distanceKm, 0);

      // Sem raio: ordena por distancia, o Rio (~360 km) entra e fica depois de SP.
      const all = await places(mestreAToken, `lat=${SP.latitude}&lng=${SP.longitude}&types=UNIT,RODA`).expect(200);
      const rioItem = all.body.items.find((i: { id: string }) => i.id === `RODA:${rodaId}`);
      assert.ok(rioItem.distanceKm > 300 && rioItem.distanceKm < 450, `Sao Paulo -> Rio ~360 km, veio ${rioItem.distanceKm}`);

      const limited = await places(mestreAToken, 'limit=1').expect(200);
      assert.equal(limited.body.items.length, 1);
      assert.ok(limited.body.total > 1);
    });

    it('mapVisible=false (PATCH /organizations/me) esconde TUDO do grupo; ligar de novo traz de volta', async () => {
      await setMapVisible(false).expect(200);
      try {
        const hidden = await places(mestreAToken, 'limit=1000').expect(200);
        assert.equal(mine(hidden.body.items).length, 0);
        const ownView = await places(orgB.token, 'limit=1000').expect(200);
        assert.equal(mine(ownView.body.items).length, 0);
        const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgB.organizationId } });
        assert.equal(row.mapVisible, false);
      } finally {
        await setMapVisible(true).expect(200);
      }
      const back = await places(mestreAToken, 'limit=1000').expect(200);
      assert.ok(mine(back.body.items).length >= 4);
    });

    it('grupo INACTIVE e unidade INACTIVE nao aparecem', async () => {
      await prisma.unit.update({ where: { id: unitId }, data: { status: 'INACTIVE' } });
      try {
        const res = await places(mestreAToken, 'types=UNIT,CLASS&limit=1000').expect(200);
        assert.equal(mine(res.body.items).length, 0);
      } finally {
        await prisma.unit.update({ where: { id: unitId }, data: { status: 'ACTIVE' } });
      }
      await prisma.organization.update({ where: { id: orgB.organizationId }, data: { status: 'INACTIVE' } });
      try {
        const res = await places(mestreAToken, 'limit=1000').expect(200);
        assert.equal(mine(res.body.items).length, 0);
      } finally {
        await prisma.organization.update({ where: { id: orgB.organizationId }, data: { status: 'ACTIVE' } });
      }
    });
  });

  describe('latitude/longitude nos CRUDs + geocodificacao opcional', () => {
    const api = (method: 'post' | 'patch', path: string) =>
      request(server())[method](`/api${path}`).set('Authorization', `Bearer ${orgB.token}`);

    it('DTO valida -90..90 / -180..180, exige o par e aceita null para limpar (unidade, evento, roda)', async () => {
      await api('post', '/units').send({ name: 'Filial Ruim', latitude: 91, longitude: 0 }).expect(400);
      await api('post', '/units').send({ name: 'Filial Ruim', latitude: 0, longitude: -181 }).expect(400);
      await api('post', '/units').send({ name: 'Filial Ruim', latitude: 10 }).expect(400); // so' uma das duas
      await api('post', '/units').send({ name: 'Filial Ruim', latitude: 'abc', longitude: 1 }).expect(400);

      const created = await api('post', '/units').send({ name: 'Filial Mapa', city: 'Campinas', state: 'SP', latitude: -22.9, longitude: -47.06 }).expect(201);
      assert.equal(created.body.latitude, -22.9);
      assert.equal(created.body.longitude, -47.06);
      const row = await prisma.unit.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(row.latitude, -22.9);

      await api('patch', `/units/${created.body.id}`).send({ latitude: 5 }).expect(400);
      const cleared = await api('patch', `/units/${created.body.id}`).send({ latitude: null, longitude: null }).expect(200);
      assert.equal(cleared.body.latitude, null);
      assert.equal(cleared.body.longitude, null);

      const event = await api('post', '/events')
        .send({ title: 'Evento Coord', date: new Date(Date.now() + 9 * DAY).toISOString(), latitude: -23.1, longitude: -46.9 })
        .expect(201);
      assert.equal(event.body.latitude, -23.1);
      await api('patch', `/events/${event.body.id}`).send({ latitude: 95, longitude: 0 }).expect(400);
      const roda = await api('post', '/rodas')
        .send({ title: 'Roda Coord', date: new Date(Date.now() + 9 * DAY).toISOString(), latitude: -23.2, longitude: -46.8 })
        .expect(201);
      assert.equal(roda.body.longitude, -46.8);
      const rodaCleared = await api('patch', `/rodas/${roda.body.id}`).send({ latitude: null, longitude: null }).expect(200);
      assert.equal(rodaCleared.body.latitude, null);
      await prisma.notification.deleteMany({ where: { organizationId: orgB.organizationId } });
    });

    it('sem coordenadas no corpo: geocodifica (so com chave) na criacao e quando o texto do local muda; coordenadas explicitas vencem', async () => {
      // Sem chave: cria normalmente, sem ponto e sem erro.
      const semChave = await api('post', '/units').send({ name: 'Filial Sem Chave', address: 'Rua B, 2', city: 'Santos', state: 'SP' }).expect(201);
      assert.equal(semChave.body.latitude, null);

      process.env.GOOGLE_MAPS_SERVER_KEY = 'server-secret-456';
      const queries: string[] = [];
      const previous = geocoding.fetchImpl;
      geocoding.fetchImpl = async (url) => {
        queries.push(new URL(url).searchParams.get('address') ?? '');
        return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: -23.96, lng: -46.33 } } }] }) };
      };
      try {
        const created = await api('post', '/units').send({ name: 'Filial Geo', address: 'Rua C, 3', city: 'Santos', state: 'SP' }).expect(201);
        assert.equal(created.body.latitude, -23.96);
        assert.equal(created.body.longitude, -46.33);
        assert.deepEqual(queries, ['Rua C, 3, Santos, SP, Brasil']);

        // PATCH sem mexer no texto do local: nao chama o Google; mudando o endereco: re-geocodifica.
        await api('patch', `/units/${created.body.id}`).send({ name: 'Filial Geo 2' }).expect(200);
        assert.equal(queries.length, 1);
        await api('patch', `/units/${created.body.id}`).send({ address: 'Rua D, 4' }).expect(200);
        assert.equal(queries.length, 2);
        assert.equal(queries[1], 'Rua D, 4, Santos, SP, Brasil');

        // Coordenadas explicitas no corpo: nao chama o Google.
        const manual = await api('patch', `/units/${created.body.id}`).send({ address: 'Rua E, 5', latitude: -1.5, longitude: -2.5 }).expect(200);
        assert.equal(queries.length, 2);
        assert.equal(manual.body.latitude, -1.5);

        // Evento/roda: geocodifica location (+ cidade/UF quando ha); sem location nao chama.
        const event = await api('post', '/events').send({ title: 'Evento Geo', date: new Date(Date.now() + 9 * DAY).toISOString(), location: 'Ginasio Z' }).expect(201);
        assert.equal(event.body.latitude, -23.96);
        assert.equal(queries.at(-1), 'Ginasio Z, Brasil');
        const before = queries.length;
        const semLocal = await api('post', '/rodas').send({ title: 'Roda Sem Local', date: new Date(Date.now() + 9 * DAY).toISOString() }).expect(201);
        assert.equal(semLocal.body.latitude, null);
        assert.equal(queries.length, before);

        // Falha do Google (rede): salva igual, sem ponto.
        geocoding.fetchImpl = async () => {
          throw new Error('timeout');
        };
        const falha = await api('post', '/units').send({ name: 'Filial Falha', address: 'Rua F, 6', city: 'Santos', state: 'SP' }).expect(201);
        assert.equal(falha.body.latitude, null);
      } finally {
        geocoding.fetchImpl = previous;
        delete process.env.GOOGLE_MAPS_SERVER_KEY;
        await prisma.notification.deleteMany({ where: { organizationId: orgB.organizationId } });
      }
    });
  });
});
