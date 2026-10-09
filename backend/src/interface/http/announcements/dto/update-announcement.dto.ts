import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

/** Limpar campo: só `unitId` aceita null (volta a ser comunicado do grupo inteiro). title, body,
 * isActive e publishedAt são obrigatórios por regra de negócio (todo comunicado nasce com data de
 * publicação — create preenche com agora): ausente = não muda; null = 400. */
export class UpdateAnnouncementDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  title?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  body?: string;

  @IsOptional()
  @IsInt()
  unitId?: number | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  publishedAt?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
