import { RecordStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Update parcial. `null` LIMPA as colunas nulláveis (unitId, teacherUserId, startTime, endTime,
 * notes). classId, date e status sao obrigatorios no schema: `null` falha a validacao (400) via
 * `@ValidateIf(v !== undefined)` (um `@IsOptional()` deixaria passar e o Prisma daria 500).
 */
export class UpdateLessonDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsInt()
  unitId?: number | null;

  @IsOptional()
  @IsInt()
  teacherUserId?: number | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  startTime?: string | null;

  @IsOptional()
  @IsString()
  endTime?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}