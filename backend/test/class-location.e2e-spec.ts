import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { GeocodingService } from '../src/shared/geo/geocoding.service';
import { ALUNO_EMAIL, createSecondOrg, loginAs, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Local do treino PROPRIO da turma (Class.address/city/state/latitude/longitude/locationLabel) no mapa da comunidade.
 * Grupo "B" = org de fixture com uma unidade em Sao Paulo; quem consulta /map/places e' o ALUNO do seed (grupo A).
 * Sem rede: o Google e' um fetch falso injetado no GeocodingService. 2a via independente = Prisma direto.
 */
const SP = { latitude: -23.5505, longitude: -46.6333 };
const PRACA = { latitude: -23.5614, longitude: -46.6559 };
const GEO = { latitude: -23.57, longitude: -46.64 };

describe('Local do treino da turma no mapa (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const server = () => app.getHttpServer();
  let orgB: SecondOrg;
  let alunoAToken: string;
  let unitId: number;
  const savedEnv: Record<string, string | undefined> = {};
  let geocoding: GeocodingService;

  const api = (method: 'get' | 'post' | 'patch', path: string) =>
    request(server())[method](`/api${path}`).set('Authorization', `Bearer ${orgB.token}`);
  const placeOf = async (classId: number) => {
    const res = await request(server()).get('/api/map/places?types=CLASS&limit=1000').set('Authorization', `Bearer ${alunoAToken}`).expect(200);
    return (res.body.items as Array<Record<string, unknown>>).find((i) => i.id === `CLASS:${classId}`);
  };

  before(async () => {
    for (const key of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_MAPS_MAP_ID']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    app = await createTestApp();
    geocoding = app.get(GeocodingService);
    alunoAToken = (await loginAs(app, ALUNO_EMAIL)).token;
    orgB = await createSecondOrg(app, prisma, 'cloc');
    const unit = await prisma.unit.create({
      data: { organizationId: orgB.organizationId, name: 'Matriz', address: 'Rua A, 1', city: 'Sao Paulo', state: 'SP', isMain: true, ...SP },
    });
    unitId = unit.id;
  });

  after(async () => {
    const orgId = orgB.organizationId;
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.lesson.deleteMany({ where: { organizationId: orgId } });
    await prisma.class.deleteMany({ where: { organizationId: orgId } });
    await prisma.unit.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('turma SEM local proprio herda unidade; com lat/lng proprios o pino e o endereco sao os do treino; limpar volta a herdar', async () => {
    const base = { name: 'Turma Heranca', unitId, weekday: 2, startTime: '19:00', endTime: '20:00', autoGenerateLessons: false };
    const created = await api('post', '/classes').send(base).expect(201);
    const id = created.body.id as number;
    assert.equal(created.body.latitude, null);
    assert.equal(created.body.locationLabel, null);

    const inherited = await placeOf(id);
    assert.ok(inherited, 'turma sem local proprio aparece (heranca)');
    assert.equal(inherited.latitude, SP.latitude);
    assert.equal(inherited.longitude, SP.longitude);
    assert.equal(inherited.address, 'Rua A, 1');
    assert.equal(inherited.locationLabel, null);

    // Define o local do treino (lat/lng + endereco + rotulo)
    const patched = await api('patch', `/classes/${id}`)
      .send({ ...PRACA, address: 'Av. Paulista, 900', city: 'Sao Paulo', state: 'sp', locationLabel: '  Praca do Treino ' })
      .expect(200);
    assert.equal(patched.body.latitude, PRACA.latitude);
    assert.equal(patched.body.state, 'SP');
    assert.equal(patched.body.locationLabel, 'Praca do Treino');
    const row = await prisma.class.findUniqueOrThrow({ where: { id } }); // 2a via
    assert.equal(row.longitude, PRACA.longitude);

    const own = await placeOf(id);
    assert.ok(own);
    assert.equal(own.latitude, PRACA.latitude);
    assert.equal(own.longitude, PRACA.longitude);
    assert.equal(own.address, 'Av. Paulista, 900');
    assert.equal(own.locationLabel, 'Praca do Treino');
    assert.equal(own.unitName, 'Matriz');

    // GET /classes/:id devolve os campos
    const detail = await api('get', `/classes/${id}`).expect(200);
    assert.equal(detail.body.address, 'Av. Paulista, 900');

    // Limpar tudo (null) volta a herdar a unidade
    const cleared = await api('patch', `/classes/${id}`)
      .send({ locationLabel: null, address: null, city: null, state: null, latitude: null, longitude: null })
      .expect(200);
    assert.equal(cleared.body.latitude, null);
    const back = await placeOf(id);
    assert.ok(back);
    assert.equal(back.latitude, SP.latitude);
    assert.equal(back.address, 'Rua A, 1');
    assert.equal(back.locationLabel, null);
  });

  it('criar ja com lat/lng proprios; so uma das coordenadas = 400; turma sem unidade com pino proprio aparece', async () => {
    await api('post', '/classes').send({ name: 'Meia Coordenada', latitude: -23.5 }).expect(400);
    await api('patch', `/classes/${(await prisma.class.findFirstOrThrow({ where: { organizationId: orgB.organizationId } })).id}`)
      .send({ longitude: -46.6 })
      .expect(400);
    await api('post', '/classes').send({ name: 'UF ruim', state: 'XX' }).expect(400);

    const withUnit = await api('post', '/classes').send({ name: 'Treino Parque', unitId, ...PRACA, address: 'Parque X', autoGenerateLessons: false }).expect(201);
    const place = await placeOf(withUnit.body.id);
    assert.ok(place);
    assert.equal(place.latitude, PRACA.latitude);

    const noUnit = await api('post', '/classes').send({ name: 'Treino Sem Unidade', ...PRACA, locationLabel: 'Orla', autoGenerateLessons: false }).expect(201);
    const orphan = await placeOf(noUnit.body.id);
    assert.ok(orphan, 'turma sem unidade mas com local proprio aparece');
    assert.equal(orphan.unitName, null);
    assert.equal(orphan.address, null);
    assert.equal(orphan.locationLabel, 'Orla');

    const noPin = await api('post', '/classes').send({ name: 'Sem Pino Nenhum', autoGenerateLessons: false }).expect(201);
    assert.equal(await placeOf(noPin.body.id), undefined, 'sem unidade e sem local proprio nao tem posicao');
  });

  it('endereco sem lat/lng: geocodifica (fetch falso); falha do Google salva sem coordenadas e herda a unidade', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'server-secret-456';
    const previous = geocoding.fetchImpl;
    const queries: string[] = [];
    geocoding.fetchImpl = async (url) => {
      queries.push(new URL(url).searchParams.get('address') ?? '');
      return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: GEO.latitude, lng: GEO.longitude } } }] }) };
    };
    try {
      const geo = await api('post', '/classes')
        .send({ name: 'Turma Geocodificada', unitId, address: 'Rua Nova, 10', city: 'Santos', state: 'SP', autoGenerateLessons: false })
        .expect(201);
      assert.equal(geo.body.latitude, GEO.latitude);
      assert.equal(queries.length, 1);
      assert.match(queries[0], /Rua Nova, 10, Santos, SP/);
      const place = await placeOf(geo.body.id);
      assert.ok(place);
      assert.equal(place.latitude, GEO.latitude);
      assert.equal(place.address, 'Rua Nova, 10');

      // Edita o endereco e o Google cai: salva igual, coordenadas antigas limpas -> volta a herdar a unidade.
      geocoding.fetchImpl = async () => {
        throw new Error('timeout');
      };
      const failed = await api('patch', `/classes/${geo.body.id}`).send({ address: 'Rua Outra, 20' }).expect(200);
      assert.equal(failed.body.address, 'Rua Outra, 20');
      assert.equal(failed.body.latitude, null);
      assert.equal(failed.body.longitude, null);
      const inherited = await placeOf(geo.body.id);
      assert.ok(inherited);
      assert.equal(inherited.latitude, SP.latitude);

      // Criar com Google fora do ar: 201, sem coordenadas.
      const down = await api('post', '/classes').send({ name: 'Google Fora', unitId, address: 'Rua F, 6', autoGenerateLessons: false }).expect(201);
      assert.equal(down.body.latitude, null);

      // Editar so o nome nao mexe no local nem chama o Google.
      geocoding.fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 1, lng: 1 } } }] }) });
      await api('patch', `/classes/${down.body.id}`).send({ name: 'Google Fora 2' }).expect(200);
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: down.body.id } })).latitude, null);
    } finally {
      geocoding.fetchImpl = previous;
      delete process.env.GOOGLE_MAPS_SERVER_KEY;
    }
  });

  it('auditoria: edicao registra os campos de local; turma inativa sai do mapa', async () => {
    const created = await api('post', '/classes').send({ name: 'Auditada', unitId, ...PRACA, autoGenerateLessons: false }).expect(201);
    const id = created.body.id as number;
    await api('patch', `/classes/${id}`).send({ address: 'Rua Y, 2', latitude: PRACA.latitude, longitude: PRACA.longitude }).expect(200);
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: orgB.organizationId, resource: 'class', resourceId: String(id), action: 'CLASS_UPDATE' },
    });
    assert.ok(logs.some((l) => JSON.stringify(l.metadata).includes('address')));

    await api('patch', `/classes/${id}`).send({ status: 'INACTIVE' }).expect(200);
    assert.equal(await placeOf(id), undefined);
  });
});
