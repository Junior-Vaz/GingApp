import { RodaRecurrence } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';

/** Limpar campo: `null` grava NULL nas colunas NULLÁVEIS (description, location, stateId, cityId,
 * communityId, imageUrl). As OBRIGATÓRIAS (title, date) usam `@ValidateIf(v !== undefined)`:
 * ausente = não muda; null = 400. `imageUrl: ""` segue inválido (IsUrl) — mande null. */
export class UpdateRodaDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  /** Coordenadas (as DUAS juntas; ambas null limpam). Sem elas, mudar location/estado/cidade re-geocodifica (se houver chave). */
  @IsOptionalLatitude()
  latitude?: number | null;

  @IsOptionalLongitude()
  longitude?: number | null;

  @IsOptional()
  @IsInt()
  stateId?: number | null;

  @IsOptional()
  @IsInt()
  cityId?: number | null;

  @IsOptional()
  @IsInt()
  communityId?: number | null;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RodaRecurrence)
  recurrence?: RodaRecurrence;

  /** null remove o fim da série. */
  @IsOptional()
  @IsDateString()
  recurrenceUntil?: string | null;
}
