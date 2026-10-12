import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';
import { IsAfterTimeOf, IsTimeOfDay } from '../../../../shared/dates/time-of-day';

export class CreateClassDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** Professor responsável: User.id de um membro ATIVO MESTRE/PROFESSOR do grupo (validado no service). */
  @IsOptional()
  @IsInt()
  teacherUserId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @IsTimeOfDay()
  startTime?: string;

  @IsOptional()
  @IsTimeOfDay()
  @IsAfterTimeOf('startTime')
  endTime?: string;

  /** Foto da turma: caminho de POST /uploads (/api/uploads/<uuid>.<ext>) ou URL http(s). null/'' = sem foto. */
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;

  /** Aulas continuas: true (padrao) = o servidor mantem as aulas geradas ate LESSONS_HORIZON_DAYS a frente (precisa de weekday). */
  @IsOptional()
  @IsBoolean()
  autoGenerateLessons?: boolean;
}
