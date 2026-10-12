import { RecordStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsAfterTimeOf, IsTimeOfDay } from '../../../../shared/dates/time-of-day';

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

  /** Professor responsável (null remove). Validado no service: membro ATIVO MESTRE/PROFESSOR do grupo. */
  @IsOptional()
  @IsInt()
  teacherUserId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number | null;

  @IsOptional()
  @IsTimeOfDay()
  startTime?: string | null;

  @IsOptional()
  @IsTimeOfDay()
  @IsAfterTimeOf('startTime')
  endTime?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  /** Foto da turma (caminho de POST /uploads ou URL http(s)). null ou '' LIMPA. */
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;

  /** Aulas continuas ligadas/desligadas (nao aceita null). Desligar nao apaga as aulas ja geradas. */
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  autoGenerateLessons?: boolean;
}
