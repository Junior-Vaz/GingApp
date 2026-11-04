import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GEO_CHECKIN_ACCURACY_FLOOR_METERS,
  GEO_CHECKIN_RADIUS_DEFAULT_METERS,
  GEO_CHECKIN_RADIUS_MAX_METERS,
  GEO_CHECKIN_RADIUS_MIN_METERS,
  distanceMeters,
  isAccuracyAcceptable,
  isWithinRadius,
  maxAccuracyMeters,
  resolveGeoCheckinLocation,
} from '../src/shared/geo/geo-checkin';

/** Testes de UNIDADE (sem banco) das regras puras do check-in por localizacao (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md). */
const METERS_PER_DEGREE = (6371 * 1000 * Math.PI) / 180; // haversine com R = 6371 km: 1 grau de latitude
const north = (lat: number, lng: number, meters: number) => ({ latitude: lat + meters / METERS_PER_DEGREE, longitude: lng });

describe('Check-in por localizacao (regras puras)', () => {
  it('constantes do contrato: raio 50..500, padrao 150; piso da precisao 100', () => {
    assert.equal(GEO_CHECKIN_RADIUS_MIN_METERS, 50);
    assert.equal(GEO_CHECKIN_RADIUS_MAX_METERS, 500);
    assert.equal(GEO_CHECKIN_RADIUS_DEFAULT_METERS, 150);
    assert.equal(GEO_CHECKIN_ACCURACY_FLOOR_METERS, 100);
  });

  it('distancia em metros (haversine) arredondada ao metro', () => {
    const base = { latitude: -23.55052, longitude: -46.633308 };
    assert.equal(distanceMeters(base, base), 0);
    assert.equal(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0.001, longitude: 0 }), 111); // 111,19 m
    assert.equal(distanceMeters(base, north(base.latitude, base.longitude, 120)), 120);
    assert.equal(distanceMeters(base, north(base.latitude, base.longitude, 149.6)), 150, 'arredonda para cima');
    assert.equal(distanceMeters(base, north(base.latitude, base.longitude, 150.4)), 150, 'arredonda para baixo');
    // simetrica
    const far = { latitude: -22.9068, longitude: -43.1729 };
    assert.equal(distanceMeters(base, far), distanceMeters(far, base));
    assert.ok(distanceMeters(base, far) > 350_000 && distanceMeters(base, far) < 362_000, 'SP-Rio ~357 km');
  });

  it('regra do raio ESTRITA: distancia <= raio', () => {
    assert.equal(isWithinRadius(0, 150), true);
    assert.equal(isWithinRadius(150, 150), true);
    assert.equal(isWithinRadius(151, 150), false);
    assert.equal(isWithinRadius(50, 50), true);
    assert.equal(isWithinRadius(51, 50), false);
  });

  it('precisao: ausente aceita; aceita ate max(100, raio); acima = sinal fraco', () => {
    assert.equal(maxAccuracyMeters(50), 100);
    assert.equal(maxAccuracyMeters(100), 100);
    assert.equal(maxAccuracyMeters(150), 150);
    assert.equal(maxAccuracyMeters(500), 500);
    assert.equal(isAccuracyAcceptable(undefined, 150), true);
    assert.equal(isAccuracyAcceptable(null, 150), true);
    assert.equal(isAccuracyAcceptable(0, 50), true);
    assert.equal(isAccuracyAcceptable(100, 50), true, 'piso de 100 m mesmo com raio 50');
    assert.equal(isAccuracyAcceptable(101, 50), false);
    assert.equal(isAccuracyAcceptable(150, 150), true);
    assert.equal(isAccuracyAcceptable(150.5, 150), false);
    assert.equal(isAccuracyAcceptable(100_000, 500), false);
  });

  it('local: o PROPRIO da turma (par completo) vence; senao o da unidade; sem nenhum = null', () => {
    const unit = { latitude: -23.5, longitude: -46.6 };
    assert.deepEqual(resolveGeoCheckinLocation({ latitude: -23.1, longitude: -46.1, unit }), {
      source: 'CLASS',
      point: { latitude: -23.1, longitude: -46.1 },
    });
    assert.deepEqual(resolveGeoCheckinLocation({ latitude: null, longitude: null, unit }), { source: 'UNIT', point: unit });
    assert.deepEqual(resolveGeoCheckinLocation({ latitude: -23.1, longitude: null, unit }), { source: 'UNIT', point: unit }, 'meio ponto nao conta');
    assert.equal(resolveGeoCheckinLocation({ latitude: null, longitude: null, unit: null }), null);
    assert.equal(resolveGeoCheckinLocation({ latitude: null, longitude: null }), null, 'turma sem unidade');
    assert.equal(resolveGeoCheckinLocation({ latitude: null, longitude: null, unit: { latitude: -23.5, longitude: null } }), null);
    // latitude/longitude 0 sao coordenadas validas (nao "vazias")
    assert.deepEqual(resolveGeoCheckinLocation({ latitude: 0, longitude: 0, unit }), { source: 'CLASS', point: { latitude: 0, longitude: 0 } });
  });
});
