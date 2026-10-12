import { Transform, Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const MAP_PLACE_TYPES = ['UNIT', 'EVENT', 'RODA', 'CLASS'] as const;
export type MapPlaceType = (typeof MAP_PLACE_TYPES)[number];

export const MAP_DEFAULT_LIMIT = 500;
export const MAP_MAX_LIMIT = 1000;

const NUMBER_OPTIONS = { allowNaN: false, allowInfinity: false };

/** Texto vazio na query ("?lat=") vira "nao enviado" em vez de 0. */
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Filtros de GET /map/places. Todos opcionais; `types` e uma lista separada por virgula
 * (UNIT,EVENT,RODA,CLASS — a validacao dos valores fica no service, que responde 400 com a lista valida).
 * `lat`/`lng` vao juntos; `radiusKm` exige os dois. `limit`: padrao 500, maximo 1000.
 */
export class MapPlacesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  types?: string;

  /** Busca textual (titulo, local, cidade, nome do grupo). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Eventos/rodas a partir desta data civil (inclusiva). Padrao: hoje. Passado so ate 30 dias atras. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  from?: string;

  /** Eventos/rodas ate esta data civil (inclusiva). */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsNumber(NUMBER_OPTIONS, { message: 'lat deve ser um numero entre -90 e 90.' })
  @Min(-90, { message: 'lat deve estar entre -90 e 90.' })
  @Max(90, { message: 'lat deve estar entre -90 e 90.' })
  lat?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsNumber(NUMBER_OPTIONS, { message: 'lng deve ser um numero entre -180 e 180.' })
  @Min(-180, { message: 'lng deve estar entre -180 e 180.' })
  @Max(180, { message: 'lng deve estar entre -180 e 180.' })
  lng?: number;

  /** Raio em km ao redor de lat/lng (0,1 a 20000). */
  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsNumber(NUMBER_OPTIONS, { message: 'radiusKm deve ser um numero.' })
  @Min(0.1, { message: 'radiusKm deve ser de no minimo 0,1.' })
  @Max(20000, { message: 'radiusKm deve ser de no maximo 20000.' })
  radiusKm?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @Type(() => Number)
  @IsNumber({ ...NUMBER_OPTIONS, maxDecimalPlaces: 0 }, { message: 'limit deve ser um inteiro.' })
  @Min(1, { message: 'limit deve ser de no minimo 1.' })
  @Max(MAP_MAX_LIMIT, { message: `limit deve ser de no maximo ${MAP_MAX_LIMIT}.` })
  limit?: number;
}
