import { IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

/** Update parcial. `null` limpa a cor; name/order nao aceitam null (400). */
export class UpdateGraduationLevelDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  color?: string | null;
}
