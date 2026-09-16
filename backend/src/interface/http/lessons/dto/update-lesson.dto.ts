import { RecordStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

/** Todos os campos opcionais (update parcial) — sem @nestjs/mapped-types para não adicionar
 * dependência só para isso; os validadores são os mesmos de CreateLessonDto. */
export class UpdateLessonDto {
  @IsOptional()
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsInt()
  teacherUserId?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
