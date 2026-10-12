import { IsDateString, IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';

/** Limpar campo: `null` grava NULL nas colunas NULLÁVEIS (description, location, stateId, cityId,
 * communityId, imageUrl). As OBRIGATÓRIAS (title, date) usam `@ValidateIf(v !== undefined)`:
 * ausente = não muda; null = 400. `imageUrl: ""` segue inválido (IsUrl) — mande null. */
export class UpdateRodaDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsInt()
  stateId?: number | null;

  @IsOptional()
  @IsInt()
  cityId?: number | null;

  @IsOptional()
  @IsInt()
  communityId?: number | null;

  @IsOptional()
  @IsImageRef()
  imageUrl?: string | null;
}
