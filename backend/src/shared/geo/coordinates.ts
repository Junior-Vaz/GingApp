import { applyDecorators } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Campos de coordenadas de um DTO: ausente = nao enviado; null = limpar. */
export interface CoordinatesInput {
  latitude?: number | null;
  longitude?: number | null;
}

const NUMBER_OPTIONS = { allowNaN: false, allowInfinity: false };

/** Latitude opcional (-90..90); aceita null (limpa a coluna no PATCH). */
export const IsOptionalLatitude = () =>
  applyDecorators(
    IsOptional(),
    IsNumber(NUMBER_OPTIONS, { message: 'latitude deve ser um numero entre -90 e 90.' }),
    Min(-90, { message: 'latitude deve estar entre -90 e 90.' }),
    Max(90, { message: 'latitude deve estar entre -90 e 90.' }),
  );

/** Longitude opcional (-180..180); aceita null (limpa a coluna no PATCH). */
export const IsOptionalLongitude = () =>
  applyDecorators(
    IsOptional(),
    IsNumber(NUMBER_OPTIONS, { message: 'longitude deve ser um numero entre -180 e 180.' }),
    Min(-180, { message: 'longitude deve estar entre -180 e 180.' }),
    Max(180, { message: 'longitude deve estar entre -180 e 180.' }),
  );

/**
 * Le o par do corpo. `undefined` = nenhum dos dois veio (nao mexer / geocodificar). Os dois juntos sao
 * obrigatorios: ambos numeros (grava) ou ambos null (limpa). Um so' => 400 (meio ponto no mapa nao existe).
 */
export function resolveCoordinatesInput(
  input: CoordinatesInput,
): { latitude: number | null; longitude: number | null } | undefined {
  const { latitude, longitude } = input;
  if (latitude === undefined && longitude === undefined) return undefined;
  if (latitude === undefined || longitude === undefined || (latitude === null) !== (longitude === null)) {
    throw new BadRequestException('Informe latitude e longitude juntas (ou ambas null para limpar).');
  }
  return { latitude, longitude };
}

/** Distancia em km entre dois pontos (formula de haversine). */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
