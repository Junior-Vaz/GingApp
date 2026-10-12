import { RodaRecurrence } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';

export class CreateRodaDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  location?: string;

  /** Coordenadas do local (opcionais, sempre as DUAS juntas); sem elas o servidor geocodifica `location` se houver chave. */
  @IsOptionalLatitude()
  latitude?: number;

  @IsOptionalLongitude()
  longitude?: number;

  @IsOptional()
  @IsInt()
  stateId?: number;

  @IsOptional()
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsInt()
  communityId?: number;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string;

  /** Recorrência (roda mensal): WEEKLY, MONTHLY_WEEKDAY ('toda 1ª sexta') ou MONTHLY_DAY ('todo dia X'), derivada de `date`.
   * As ocorrências são geradas por POST /rodas/:id/generate-occurrences. Omitido = NONE. */
  @IsOptional()
  @IsEnum(RodaRecurrence)
  recurrence?: RodaRecurrence;

  /** Último dia da série (ISO; só data = fim do dia). Omitido = sem fim. */
  @IsOptional()
  @IsDateString()
  recurrenceUntil?: string;
}
