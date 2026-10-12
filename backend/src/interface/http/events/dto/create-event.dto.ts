import { EventStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { EVENT_TYPES } from './event-type';
import { IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';

export class CreateEventDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  description?: string;

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
  unitId?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: string;

  @IsOptional()
  @IsInt()
  stateId?: number;

  @IsOptional()
  @IsInt()
  cityId?: number;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string;

  /** Vagas (omitido = ilimitado). Lotado => 409; o inscrito pode entrar na lista de espera. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number;

  /** Valor da inscricao em CENTAVOS (omitido/0 = gratuito). Informativo: sem pagamento online. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  priceCents?: number;

  /** Omitido = PUBLISHED. DRAFT so a equipe ve. */
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  /** Prazo das inscricoes feitas pelo proprio aluno/responsavel (ISO). */
  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;
}
