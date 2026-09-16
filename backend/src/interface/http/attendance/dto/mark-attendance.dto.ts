import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Um item da chamada em lote: presença de um aluno numa aula.
 * Corpo do POST /attendance/lessons/:lessonId é um array de AttendanceEntryDto
 * (validado via ParseArrayPipe no controller).
 */
export class AttendanceEntryDto {
  @IsInt()
  studentId!: number;

  @IsBoolean()
  present!: boolean;

  @IsOptional()
  @IsString()
  justification?: string;
}
