import { RecordStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';
import { blankImageToNull, IsImageRef } from '../../../../shared/uploads/image-ref';
import { UF_MESSAGE } from './create-unit.dto';

/** Aparar espaços; texto vazio vira `null` (LIMPA a coluna no PATCH); `undefined` = não mexe. */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
const ufOrNull = ({ value }: { value: unknown }) => {
  const trimmed = trimOrNull({ value });
  return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed;
};

/**
 * PATCH /units/:id — update parcial. Campo ausente = não mexe; `null` (ou texto vazio) LIMPA
 * address/city/state/photo. `name`, `isMain` e `status` não aceitam null (400). `organizationId` não existe aqui.
 * As regras de negócio (matriz única, não inativar a única unidade ativa/a matriz, limite do plano ao
 * reativar) ficam no UnitsService, onde enxergam o estado do grupo.
 */
export class UpdateUnitDto {
  @ValidateIf((_, v) => v !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Transform(ufOrNull)
  @IsIn(BR_UFS, { message: UF_MESSAGE })
  state?: string | null;

  /** Coordenadas (as DUAS juntas; ambas null limpam). Sem elas, mudar address/city/state re-geocodifica (se houver chave). */
  @IsOptionalLatitude()
  latitude?: number | null;

  @IsOptionalLongitude()
  longitude?: number | null;

  /** Foto da unidade (caminho de POST /uploads ou URL http(s)). null ou '' LIMPA. */
  @IsOptional()
  @Transform(blankImageToNull)
  @IsImageRef()
  photo?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  isMain?: boolean;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
