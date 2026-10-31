import { CertificatePurpose } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CERTIFICATE_PRESET_KEYS } from '../certificate-presets';

/**
 * DTOs dos modelos de certificado (docs/CONTRATO_CERTIFICADOS_MODELOS.md secao 7). O DTO garante so os TIPOS de topo;
 * o conteudo de `layout` (whitelist de chaves, faixas, cores, variaveis, limites) e validado por
 * validateCertificateLayout no service — o ValidationPipe global nao entra em objetos sem @ValidateNested.
 */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const PURPOSE_MESSAGE = `purpose deve ser um de: ${Object.values(CertificatePurpose).join(', ')}.`;

/** POST /certificate-templates: `{ name, purpose, layout }` OU `{ name, purpose?, presetKey }` (um dos dois, nunca ambos). */
export class CreateCertificateTemplateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'name não pode ficar vazio.' })
  @MaxLength(60, { message: 'name deve ter no máximo 60 caracteres.' })
  name!: string;

  @IsOptional()
  @IsEnum(CertificatePurpose, { message: PURPOSE_MESSAGE })
  purpose?: CertificatePurpose;

  @IsOptional()
  @IsObject({ message: 'layout deve ser um objeto (o desenho do certificado).' })
  layout?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(CERTIFICATE_PRESET_KEYS, { message: `presetKey deve ser um de: ${CERTIFICATE_PRESET_KEYS.join(', ')}.` })
  presetKey?: string;
}

/** PATCH /certificate-templates/:id — ausente = não muda; null = 400 (nenhum campo se "limpa"). */
export class UpdateCertificateTemplateDto {
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'name não pode ficar vazio.' })
  @MaxLength(60, { message: 'name deve ter no máximo 60 caracteres.' })
  name?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(CertificatePurpose, { message: PURPOSE_MESSAGE })
  purpose?: CertificatePurpose;

  @ValidateIf((_, v) => v !== undefined)
  @IsObject({ message: 'layout deve ser um objeto (o desenho do certificado).' })
  layout?: Record<string, unknown>;
}

/** POST /certificate-templates/preview */
export class PreviewCertificateTemplateDto {
  @IsObject({ message: 'layout deve ser um objeto (o desenho do certificado).' })
  layout!: Record<string, unknown>;
}
