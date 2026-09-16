import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/** Todos os campos opcionais (update parcial) — mesmo padrão de UpdateStudentDto. */
export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
