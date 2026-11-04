import { Coordinates, haversineKm } from './coordinates';

/**
 * Regras PURAS do check-in por localizacao (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md). Sem Nest/Prisma: usadas pelo
 * service do check-in, pela turma (geoCheckinLocation) e pelos testes unitarios. As coordenadas do ALUNO so passam por
 * aqui em memoria: nada neste arquivo guarda ou registra posicao.
 */

/** Faixa do raio permitido (metros, inteiro) e o padrao da coluna Class.geoCheckinRadiusMeters. */
export const GEO_CHECKIN_RADIUS_MIN_METERS = 50;
export const GEO_CHECKIN_RADIUS_MAX_METERS = 500;
export const GEO_CHECKIN_RADIUS_DEFAULT_METERS = 150;
/** Precisao informada pelo aparelho acima de max(piso, raio) = sinal de GPS fraco (400 GEO_ACCURACY_LOW). */
export const GEO_CHECKIN_ACCURACY_FLOOR_METERS = 100;

/** De onde vem o local usado no check-in por localizacao: coordenadas PROPRIAS da turma ou as da UNIDADE. */
export type GeoCheckinLocationSource = 'CLASS' | 'UNIT';

interface MaybeCoordinates {
  latitude: number | null;
  longitude: number | null;
}

/** Ponto so existe com o PAR completo (meio ponto no mapa nao existe), mesma regra do mapa (map.service.ts). */
function pointOf(value: MaybeCoordinates | null | undefined): Coordinates | null {
  if (!value || value.latitude === null || value.longitude === null) return null;
  return { latitude: value.latitude, longitude: value.longitude };
}

/**
 * Local da turma (SSOT do contrato secao 2): as coordenadas PROPRIAS da turma se houver o par; senao as da UNIDADE da
 * turma; sem nenhuma = null (sem local).
 */
export function resolveGeoCheckinLocation(
  klass: MaybeCoordinates & { unit?: MaybeCoordinates | null },
): { source: GeoCheckinLocationSource; point: Coordinates } | null {
  const own = pointOf(klass);
  if (own) return { source: 'CLASS', point: own };
  const unit = pointOf(klass.unit);
  return unit ? { source: 'UNIT', point: unit } : null;
}

/** Distancia (haversine) em METROS, arredondada ao metro. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  return Math.round(haversineKm(a, b) * 1000);
}

/** Maior precisao aceita (metros) para um raio: max(100, raio). */
export function maxAccuracyMeters(radiusMeters: number): number {
  return Math.max(GEO_CHECKIN_ACCURACY_FLOOR_METERS, radiusMeters);
}

/** Precisao nao informada = aceita; informada e maior que max(100, raio) = recusada. */
export function isAccuracyAcceptable(accuracyMeters: number | undefined | null, radiusMeters: number): boolean {
  return accuracyMeters === undefined || accuracyMeters === null || accuracyMeters <= maxAccuracyMeters(radiusMeters);
}

/** Regra ESTRITA do contrato: dentro = distancia (ja arredondada) <= raio. */
export function isWithinRadius(distance: number, radiusMeters: number): boolean {
  return distance <= radiusMeters;
}
