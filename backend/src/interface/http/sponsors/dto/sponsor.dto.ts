import { SponsorCampaignStatus, SponsorCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { OptionalStudentId } from '../../../../shared/access/linked-student';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { blankImageToNull } from '../../../../shared/uploads/image-ref';
import { EFFECTIVE_STATUSES, EffectiveStatus, SPONSOR_LIMITS } from '../sponsor-rules';

/**
 * DTOs dos patrocinadores (docs/CONTRATO_PATROCINADORES.md secao 4). O DTO barra TIPO e tamanho bruto (com folga); a regra
 * fina (texto puro normalizado, minimo/maximo apos normalizar, URL 2.6, UFs, janela, imagem de plataforma) e do service,
 * sempre com 400 em portugues citando o campo. Campos extras = 400 (ValidationPipe forbidNonWhitelisted).
 */

/** Texto vazio/so espacos vira null (LIMPA a coluna opcional); undefined = nao mexe. */
const blankToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Campo obrigatorio no PATCH: ausente = nao mexe; presente (inclusive null) = validado (null => 400). */
const IfPresent = () => ValidateIf((_o, v) => v !== undefined);

// ---------------------------------------------------------------------------------------------------------------
// Patrocinador
// ---------------------------------------------------------------------------------------------------------------

export class CreateSponsorDto {
  @IsString({ message: 'name: informe o nome do patrocinador.' })
  @MaxLength(300, { message: 'name: no máximo 80 caracteres.' })
  name: string;

  @IsOptional()
  @Transform(blankImageToNull)
  @IsString({ message: 'logo: use o caminho devolvido por POST /platform-uploads.' })
  @MaxLength(200, { message: 'logo: caminho inválido.' })
  logo?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'contactName: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.contactNameMax, { message: `contactName: no máximo ${SPONSOR_LIMITS.contactNameMax} caracteres.` })
  contactName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'contactEmail: e-mail inválido.' })
  @MaxLength(SPONSOR_LIMITS.contactEmailMax, { message: `contactEmail: no máximo ${SPONSOR_LIMITS.contactEmailMax} caracteres.` })
  contactEmail?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'contactPhone: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.contactPhoneMax, { message: `contactPhone: no máximo ${SPONSOR_LIMITS.contactPhoneMax} caracteres.` })
  contactPhone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'document: deve ser texto (CNPJ/CPF).' })
  @MaxLength(SPONSOR_LIMITS.documentMax, { message: `document: no máximo ${SPONSOR_LIMITS.documentMax} caracteres.` })
  document?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'notes: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.notesMax + 200, { message: `notes: no máximo ${SPONSOR_LIMITS.notesMax} caracteres.` })
  notes?: string | null;
}

export class UpdateSponsorDto {
  @IfPresent()
  @IsString({ message: 'name: informe o nome do patrocinador.' })
  @MaxLength(300, { message: 'name: no máximo 80 caracteres.' })
  name?: string;

  @IsOptional()
  @Transform(blankImageToNull)
  @IsString({ message: 'logo: use o caminho devolvido por POST /platform-uploads.' })
  @MaxLength(200, { message: 'logo: caminho inválido.' })
  logo?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'contactName: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.contactNameMax, { message: `contactName: no máximo ${SPONSOR_LIMITS.contactNameMax} caracteres.` })
  contactName?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'contactEmail: e-mail inválido.' })
  @MaxLength(SPONSOR_LIMITS.contactEmailMax, { message: `contactEmail: no máximo ${SPONSOR_LIMITS.contactEmailMax} caracteres.` })
  contactEmail?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'contactPhone: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.contactPhoneMax, { message: `contactPhone: no máximo ${SPONSOR_LIMITS.contactPhoneMax} caracteres.` })
  contactPhone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'document: deve ser texto (CNPJ/CPF).' })
  @MaxLength(SPONSOR_LIMITS.documentMax, { message: `document: no máximo ${SPONSOR_LIMITS.documentMax} caracteres.` })
  document?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'notes: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.notesMax + 200, { message: `notes: no máximo ${SPONSOR_LIMITS.notesMax} caracteres.` })
  notes?: string | null;
}

export class ListSponsorsQueryDto extends PageQueryDto {}

// ---------------------------------------------------------------------------------------------------------------
// Campanha
// ---------------------------------------------------------------------------------------------------------------

export class CreateSponsorCampaignDto {
  @IsInt({ message: 'sponsorId: informe o id (número inteiro) do patrocinador.' })
  @Min(1, { message: 'sponsorId: informe o id (número inteiro) do patrocinador.' })
  sponsorId: number;

  @IsString({ message: 'title: informe o título (2 a 60 caracteres).' })
  @MaxLength(300, { message: 'title: no máximo 60 caracteres.' })
  title: string;

  @IsString({ message: 'text: informe o texto (2 a 90 caracteres).' })
  @MaxLength(500, { message: 'text: no máximo 90 caracteres.' })
  text: string;

  @IsOptional()
  @Transform(blankImageToNull)
  @IsString({ message: 'imageRef: use o caminho devolvido por POST /platform-uploads.' })
  @MaxLength(200, { message: 'imageRef: caminho inválido.' })
  imageRef?: string | null;

  @IsOptional()
  @IsString({ message: 'ctaLabel: texto do botão (2 a 24 caracteres).' })
  @MaxLength(200, { message: 'ctaLabel: no máximo 24 caracteres.' })
  ctaLabel?: string | null;

  @IsString({ message: 'destinationUrl: informe o endereço de destino (https://...).' })
  @MaxLength(2048, { message: `destinationUrl: o endereço pode ter no máximo ${SPONSOR_LIMITS.urlMax} caracteres.` })
  destinationUrl: string;

  @IsEnum(SponsorCategory, { message: `category: categoria inválida. Use uma de: ${Object.values(SponsorCategory).join(', ')}.` })
  category: SponsorCategory;

  @IsISO8601({ strict: true }, { message: 'startsAt: data/hora de início inválida (ISO 8601, ex.: 2026-11-10T00:00:00-03:00).' })
  startsAt: string;

  @IsISO8601({ strict: true }, { message: 'endsAt: data/hora de fim inválida (ISO 8601, ex.: 2026-12-10T00:00:00-03:00).' })
  endsAt: string;

  @IsOptional()
  @IsInt({ message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  @Min(SPONSOR_LIMITS.weightMin, { message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  @Max(SPONSOR_LIMITS.weightMax, { message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  weight?: number;

  @IsOptional()
  @IsArray({ message: 'states: lista de siglas de UF (ex.: ["GO","SP"]); vazia = Brasil todo.' })
  @ArrayMaxSize(27, { message: 'states: no máximo as 27 UFs.' })
  @IsString({ each: true, message: 'states: cada item deve ser a sigla de uma UF (ex.: GO).' })
  @MaxLength(10, { each: true, message: 'states: cada item deve ser a sigla de uma UF (ex.: GO).' })
  states?: string[];

  @IsOptional()
  @IsInt({ message: 'priceCents: valor em centavos (inteiro >= 0).' })
  @Min(0, { message: 'priceCents: valor em centavos (inteiro >= 0).' })
  @Max(SPONSOR_LIMITS.priceCentsMax, { message: 'priceCents: valor alto demais.' })
  priceCents?: number | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'billingNote: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.billingNoteMax + 200, { message: `billingNote: no máximo ${SPONSOR_LIMITS.billingNoteMax} caracteres.` })
  billingNote?: string | null;
}

export class UpdateSponsorCampaignDto {
  @IfPresent()
  @IsInt({ message: 'sponsorId: informe o id (número inteiro) do patrocinador.' })
  @Min(1, { message: 'sponsorId: informe o id (número inteiro) do patrocinador.' })
  sponsorId?: number;

  @IfPresent()
  @IsString({ message: 'title: informe o título (2 a 60 caracteres).' })
  @MaxLength(300, { message: 'title: no máximo 60 caracteres.' })
  title?: string;

  @IfPresent()
  @IsString({ message: 'text: informe o texto (2 a 90 caracteres).' })
  @MaxLength(500, { message: 'text: no máximo 90 caracteres.' })
  text?: string;

  @IsOptional()
  @Transform(blankImageToNull)
  @IsString({ message: 'imageRef: use o caminho devolvido por POST /platform-uploads.' })
  @MaxLength(200, { message: 'imageRef: caminho inválido.' })
  imageRef?: string | null;

  @IsOptional()
  @IsString({ message: 'ctaLabel: texto do botão (2 a 24 caracteres).' })
  @MaxLength(200, { message: 'ctaLabel: no máximo 24 caracteres.' })
  ctaLabel?: string | null;

  @IfPresent()
  @IsString({ message: 'destinationUrl: informe o endereço de destino (https://...).' })
  @MaxLength(2048, { message: `destinationUrl: o endereço pode ter no máximo ${SPONSOR_LIMITS.urlMax} caracteres.` })
  destinationUrl?: string;

  @IfPresent()
  @IsEnum(SponsorCategory, { message: `category: categoria inválida. Use uma de: ${Object.values(SponsorCategory).join(', ')}.` })
  category?: SponsorCategory;

  @IfPresent()
  @IsISO8601({ strict: true }, { message: 'startsAt: data/hora de início inválida (ISO 8601, ex.: 2026-11-10T00:00:00-03:00).' })
  startsAt?: string;

  @IfPresent()
  @IsISO8601({ strict: true }, { message: 'endsAt: data/hora de fim inválida (ISO 8601, ex.: 2026-12-10T00:00:00-03:00).' })
  endsAt?: string;

  @IfPresent()
  @IsInt({ message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  @Min(SPONSOR_LIMITS.weightMin, { message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  @Max(SPONSOR_LIMITS.weightMax, { message: `weight: peso inteiro de ${SPONSOR_LIMITS.weightMin} a ${SPONSOR_LIMITS.weightMax}.` })
  weight?: number;

  @IfPresent()
  @IsArray({ message: 'states: lista de siglas de UF (ex.: ["GO","SP"]); vazia = Brasil todo.' })
  @ArrayMaxSize(27, { message: 'states: no máximo as 27 UFs.' })
  @IsString({ each: true, message: 'states: cada item deve ser a sigla de uma UF (ex.: GO).' })
  @MaxLength(10, { each: true, message: 'states: cada item deve ser a sigla de uma UF (ex.: GO).' })
  states?: string[];

  @IsOptional()
  @IsInt({ message: 'priceCents: valor em centavos (inteiro >= 0).' })
  @Min(0, { message: 'priceCents: valor em centavos (inteiro >= 0).' })
  @Max(SPONSOR_LIMITS.priceCentsMax, { message: 'priceCents: valor alto demais.' })
  priceCents?: number | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString({ message: 'billingNote: deve ser texto.' })
  @MaxLength(SPONSOR_LIMITS.billingNoteMax + 200, { message: `billingNote: no máximo ${SPONSOR_LIMITS.billingNoteMax} caracteres.` })
  billingNote?: string | null;
}

export class ListSponsorCampaignsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(SponsorCampaignStatus, { message: 'status: use DRAFT, ACTIVE ou PAUSED.' })
  status?: SponsorCampaignStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'sponsorId: número inteiro.' })
  @Min(1, { message: 'sponsorId: número inteiro.' })
  sponsorId?: number;

  @IsOptional()
  @IsIn(EFFECTIVE_STATUSES as EffectiveStatus[], { message: `effective: use ${EFFECTIVE_STATUSES.join(', ')}.` })
  effective?: EffectiveStatus;
}

// ---------------------------------------------------------------------------------------------------------------
// Plataforma: supervisao dos grupos (docs/CONTRATO_PATROCINADORES_GRUPO.md secao 4)
// ---------------------------------------------------------------------------------------------------------------

/** `?scope=GROUP&organizationId=` (supervisao); sem scope = so os da plataforma (comportamento da Fase 1). */
type PlatformListScope = 'PLATFORM' | 'GROUP';

export class PlatformListSponsorsQueryDto extends ListSponsorsQueryDto {
  @IsOptional()
  @IsIn(['PLATFORM', 'GROUP'], { message: 'scope: use PLATFORM ou GROUP.' })
  scope?: PlatformListScope;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'organizationId: número inteiro.' })
  @Min(1, { message: 'organizationId: número inteiro.' })
  organizationId?: number;
}

export class PlatformListSponsorCampaignsQueryDto extends ListSponsorCampaignsQueryDto {
  @IsOptional()
  @IsIn(['PLATFORM', 'GROUP'], { message: 'scope: use PLATFORM ou GROUP.' })
  scope?: PlatformListScope;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'organizationId: número inteiro.' })
  @Min(1, { message: 'organizationId: número inteiro.' })
  organizationId?: number;
}

/** Motivo da suspensao/bloqueio (3..300; a regra fina e normalizeReason no service). Opcional no levantar/liberar. */
export class SponsorReasonDto {
  @IsOptional()
  @IsString({ message: 'reason: informe o motivo (3 a 300 caracteres).' })
  @MaxLength(1000, { message: 'reason: no máximo 300 caracteres.' })
  reason?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Mestre: termo de responsabilidade
// ---------------------------------------------------------------------------------------------------------------

export class AcceptSponsorTermsDto {
  @IsString({ message: 'version: informe a versão do termo que você leu (campo version de GET /group-sponsors/terms).' })
  @MaxLength(50, { message: 'version: versão inválida.' })
  version: string;
}

export class SponsorReportQueryDto {
  @IsOptional()
  @IsString({ message: 'from: data inicial no formato AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @IsString({ message: 'to: data final no formato AAAA-MM-DD.' })
  to?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------------------------

/** `?studentId=` opcional (seletor de dependente do app); vinculo conferido por StudentsService.resolveLink. */
export class SponsorViewerQueryDto {
  @OptionalStudentId()
  studentId?: number;
}
