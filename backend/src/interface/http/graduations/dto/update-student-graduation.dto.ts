import { IsDateString, IsInt, IsOptional, IsString, ValidateIf } from 'class-validator';

/** Update parcial. `null` limpa as observacoes; nivel e data nao aceitam null (400). */
export class UpdateStudentGraduationDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  graduationLevelId?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  graduatedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
