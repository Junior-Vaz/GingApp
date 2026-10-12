import { OrgRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';

const upperUf = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

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

  /** null remove o recorte por turma / UF / papel (volta a valer só o alcance da unidade). NÃO notifica de novo. */
  @IsOptional()
  @IsInt()
  classId?: number | null;

  @IsOptional()
  @Transform(upperUf)
  @IsIn(BR_UFS, { message: 'stateUf deve ser a sigla de uma UF brasileira (ex.: GO, SP).' })
  stateUf?: string | null;

  @IsOptional()
  @IsEnum(OrgRole)
  audienceRole?: OrgRole | null;
}
