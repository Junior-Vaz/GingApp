import { RecordStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * Update parcial. `null` LIMPA as colunas nulláveis (unitId, description, weekday, startTime,
 * endTime). name e status sao obrigatorios: `null` falha a validacao (400) via
 * `@ValidateIf(v !== undefined)` (um `@IsOptional()` deixaria passar e o Prisma daria 500).
 */
export class UpdateClassDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  unitId?: number | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @IsOptional()
  @IsString()
  startTime?: string | null;

  @IsOptional()
  @IsString()
  endTime?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}