import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';
import { IsOptionalLatitude, IsOptionalLongitude } from '../../../../shared/geo/coordinates';

/** Aparar espaços; texto vazio vira `undefined` (campo omitido) — qualquer outro tipo passa e a validação reprova. */
export const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** UF em maiúsculas (aceita "go"); texto vazio = omitido. */
export const ufOrUndefined = ({ value }: { value: unknown }) => {
  const trimmed = trimOrUndefined({ value });
  return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed;
};

export const UF_MESSAGE = 'state deve ser a sigla de uma UF brasileira (ex.: GO, SP, RJ).';

/**
 * POST /units — cria uma unidade (matriz ou filial) no grupo do token. `organizationId` NUNCA vem do
 * corpo (o ValidationPipe global, com forbidNonWhitelisted, responde 400 se vier). `status` também não:
 * a unidade nasce ACTIVE (inativar é DELETE/PATCH).
 */
export class CreateUnitDto {
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(ufOrUndefined)
  @IsIn(BR_UFS, { message: UF_MESSAGE })
  state?: string;

  /** Coordenadas para o mapa da comunidade (opcionais, sempre as DUAS juntas). Sem elas, o servidor tenta
   * geocodificar address/city/state quando ha chave do Google (GOOGLE_MAPS_SERVER_KEY). */
  @IsOptionalLatitude()
  latitude?: number;

  @IsOptionalLongitude()
  longitude?: number;

  /** Matriz do grupo. Ao marcar true, a matriz anterior (se houver) deixa de ser matriz — só há UMA por grupo.
   * Omitido: vira matriz automaticamente se o grupo ainda não tem uma matriz ativa. */
  @IsOptional()
  @IsBoolean()
  isMain?: boolean;
}
