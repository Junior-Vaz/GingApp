import { EventStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EVENT_TYPES } from './event-type';
import { IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';

/** Todos os campos opcionais (update parcial) — mesmo padrão de UpdateStudentDto.
 *
 * Limpar campo: `null` grava NULL nas colunas NULLÁVEIS (description, location, unitId, stateId,
 * cityId, imageUrl). As OBRIGATÓRIAS (title, date, type, isPublic) usam
 * `@ValidateIf(v !== undefined)`: ausente = não muda; null = 400. `imageUrl: ""` segue inválido
 * (IsUrl) — o cliente deve mandar null para remover a capa. */
export class UpdateEventDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  title?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

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
  unitId?: number | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isPublic?: boolean;

  @ValidateIf((_, v) => v !== undefined)
  @IsIn(EVENT_TYPES)
  type?: string;

  @IsOptional()
  @IsInt()
  stateId?: number | null;

  @IsOptional()
  @IsInt()
  cityId?: number | null;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string | null;

  /** null = ilimitado. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number | null;

  /** null/0 = gratuito. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  priceCents?: number | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(EventStatus)
  status?: EventStatus;

  /** null = sem prazo. */
  @IsOptional()
  @IsDateString()
  registrationDeadline?: string | null;
}
