import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BadRequestException, Logger } from '@nestjs/common';
import { haversineKm, resolveCoordinatesInput } from '../src/shared/geo/coordinates';
import { GeocodingService } from '../src/shared/geo/geocoding.service';

const KEYS = ['GOOGLE_MAPS_SERVER_KEY', 'GOOGLE_MAPS_API_KEY'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe('GeocodingService (shared/geo)', () => {
  it('sem chave: desligado, devolve null e nem chama o fetch', async () => {
    for (const k of KEYS) delete process.env[k];
    const service = new GeocodingService();
    let calls = 0;
    service.fetchImpl = async () => {
      calls += 1;
      return { ok: true, json: async () => ({}) };
    };
    assert.equal(service.isEnabled(), false);
    assert.equal(await service.geocode('Rua A, Goiania'), null);
    assert.equal(calls, 0);
  });

  it('com chave: prefere a de servidor, parseia lat/lng e anexa ", Brasil" nas partes; nunca lanca nem loga a chave', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_SERVER_KEY = 'segredo-do-servidor';
    const logged: string[] = [];
    const original = Logger.prototype.warn;
    Logger.prototype.warn = function (message: unknown) {
      logged.push(String(message));
    };
    try {
      const service = new GeocodingService();
      const urls: string[] = [];
      service.fetchImpl = async (url) => {
        urls.push(url);
        return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: -16.68, lng: -49.25 } } }] }) };
      };
      assert.equal(service.isEnabled(), true);
      assert.deepEqual(await service.geocodeParts(['Rua 7, 450', ' ', 'Goiania', 'GO']), { latitude: -16.68, longitude: -49.25 });
      const url = new URL(urls[0]);
      assert.equal(url.searchParams.get('address'), 'Rua 7, 450, Goiania, GO, Brasil');
      assert.equal(url.searchParams.get('key'), 'segredo-do-servidor');

      for (const bad of [
        ok({ status: 'ZERO_RESULTS', results: [] }),
        ok({ status: 'REQUEST_DENIED', results: [] }),
        ok({ status: 'OK', results: [{ geometry: { location: { lat: 'x', lng: 1 } } }] }),
        ok({ status: 'OK', results: [{ geometry: { location: { lat: 95, lng: 1 } } }] }),
        async () => ({ ok: false, json: async () => ({}) }),
        async () => {
          throw new Error(`falha com ${url.toString()}`); // erro de rede carregando a URL (e a chave)
        },
      ]) {
        service.fetchImpl = bad;
        assert.equal(await service.geocode('Rua X'), null);
      }
      assert.ok(logged.length > 0, 'falhas deixam um aviso generico');
      assert.ok(!logged.join('\n').includes('segredo-do-servidor'), 'a chave nunca vai para o log');
      assert.equal(await service.geocodeParts([null, '', '  ']), null);
    } finally {
      Logger.prototype.warn = original;
    }
  });

  it('forCreate/forUpdate: coordenadas do corpo vencem; update so geocodifica se o texto mudou e mantem o ponto atual se nao achar', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'k';
    const service = new GeocodingService();
    let calls = 0;
    service.fetchImpl = async () => {
      calls += 1;
      return { ok: true, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 1, lng: 2 } } }] }) };
    };
    assert.deepEqual(await service.forCreate({ latitude: 5, longitude: 6 }, ['x']), { latitude: 5, longitude: 6 });
    assert.equal(calls, 0);
    assert.deepEqual(await service.forCreate({}, ['Rua A']), { latitude: 1, longitude: 2 });
    assert.equal(await service.forUpdate({}, false, ['Rua A']), undefined);
    assert.deepEqual(await service.forUpdate({ latitude: null, longitude: null }, true, ['Rua A']), { latitude: null, longitude: null });
    assert.deepEqual(await service.forUpdate({}, true, ['Rua A']), { latitude: 1, longitude: 2 });
    service.fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'ZERO_RESULTS' }) });
    assert.equal(await service.forUpdate({}, true, ['Rua A']), undefined); // nao achou: nao apaga o ponto atual
    assert.deepEqual(await service.forCreate({}, ['Rua A']), { latitude: null, longitude: null });
  });
});

describe('coordinates (shared/geo)', () => {
  it('resolveCoordinatesInput: nenhum = undefined; par = par; null/null = limpar; metade = 400', () => {
    assert.equal(resolveCoordinatesInput({}), undefined);
    assert.deepEqual(resolveCoordinatesInput({ latitude: 1, longitude: 2 }), { latitude: 1, longitude: 2 });
    assert.deepEqual(resolveCoordinatesInput({ latitude: null, longitude: null }), { latitude: null, longitude: null });
    assert.throws(() => resolveCoordinatesInput({ latitude: 1 }), BadRequestException);
    assert.throws(() => resolveCoordinatesInput({ latitude: 1, longitude: null }), BadRequestException);
  });

  it('haversineKm: Goiania -> Brasilia ~170 km; mesmo ponto = 0', () => {
    const goiania = { latitude: -16.6869, longitude: -49.2648 };
    const brasilia = { latitude: -15.7939, longitude: -47.8828 };
    const km = haversineKm(goiania, brasilia);
    assert.ok(km > 165 && km < 180, `esperado ~170 km, veio ${km}`);
    assert.equal(haversineKm(goiania, goiania), 0);
  });
});
