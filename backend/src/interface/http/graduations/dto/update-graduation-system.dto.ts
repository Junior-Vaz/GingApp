import { IsBoolean, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

/** Update parcial. `null` limpa a descricao; name/isActive nao aceitam null (400). */
export class UpdateGraduationSystemDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
