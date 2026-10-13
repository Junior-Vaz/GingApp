import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';
import { IsImageRef } from '../../../../shared/uploads/image-ref';
import { DOCUMENT_PATTERN, PHONE_PATTERN, trim } from './create-organization.dto';

/** URL absoluta http(s) — vira <a href>/<img src> no painel e no app: nunca "javascript:" nem relativa. */
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true, require_tld: true };
const URL_MESSAGE = (field: string) => `${field} deve ser uma URL http(s) completa (ex.: https://...).`;

/** Aparar espaços; texto vazio vira `null` (LIMPA a coluna). Outros tipos passam e a validação reprova. */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
const ufOrNull = ({ value }: { value: unknown }) => {
  const trimmed = trimOrNull({ value });
  return typeof trimmed === 'string' ? trimmed.toUpperCase() : trimmed;
};

/** Redes sociais do grupo — conjunto fixo (não é JSON livre). Enviar `socialLinks` SUBSTITUI o objeto
 * inteiro; para remover uma rede, reenvie sem a chave (`null` numa rede equivale a omiti-la). */
export class OrganizationSocialLinksDto {
  @IsOptional()
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('instagram') })
  @MaxLength(300)
  instagram?: string | null;

  @IsOptional()
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('youtube') })
  @MaxLength(300)
  youtube?: string | null;

  @IsOptional()
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('tiktok') })
  @MaxLength(300)
  tiktok?: string | null;

  @IsOptional()
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('facebook') })
  @MaxLength(300)
  facebook?: string | null;

  @IsOptional()
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('whatsapp') })
  @MaxLength(300)
  whatsapp?: string | null;
}

/**
 * PATCH /organizations/me — o MESTRE edita o PRÓPRIO grupo (o da organização do token). Update parcial:
 * campo ausente = não mexe; `null` (ou texto vazio) LIMPA os campos opcionais. `name` não aceita null.
 *
 * NÃO existem aqui, de propósito: `slug` (identificador imutável), `status` (ativar/desativar é da equipe
 * GingApp), `type`, `id`, `organizationId`. O ValidationPipe global (forbidNonWhitelisted) responde 400 se vierem.
 * As validações de name/document/email/phone são as mesmas do PATCH /organizations/:id (super admin).
 */
export class UpdateOwnOrganizationDto {
  @ValidateIf((_, v) => v !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @Matches(DOCUMENT_PATTERN, { message: 'document deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).' })
  document?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail({}, { message: 'email deve ser um e-mail válido.' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone deve ter de 8 a 30 caracteres entre dígitos, +, (), - e espaço.' })
  phone?: string | null;

  /** Apresentação curta do grupo. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  /** História do grupo (texto longo). */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(10000)
  history?: string | null;

  /** Ano de fundação (1800..2100). */
  @IsOptional()
  @IsInt({ message: 'foundedYear deve ser um ano inteiro (ex.: 1998).' })
  @Min(1800, { message: 'foundedYear deve ser maior ou igual a 1800.' })
  @Max(2100, { message: 'foundedYear deve ser menor ou igual a 2100.' })
  foundedYear?: number | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  /** Sigla da UF-sede (aceita minúsculas; gravada em maiúsculas). */
  @IsOptional()
  @Transform(ufOrNull)
  @IsIn(BR_UFS, { message: 'state deve ser a sigla de uma UF brasileira (ex.: GO, SP, RJ).' })
  state?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsUrl(HTTP_URL, { message: URL_MESSAGE('website') })
  @MaxLength(300)
  website?: string | null;

  /** URL da logomarca: o caminho devolvido por POST /uploads (/api/uploads/<arquivo>) ou uma URL http(s) completa. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsImageRef()
  @MaxLength(500)
  logo?: string | null;

  /** "Como pagar" (E07): texto livre mostrado ao aluno/responsável no app (chave PIX, dados bancários, orientações). */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  paymentInstructions?: string | null;

  /** Mapa da comunidade: false esconde o grupo (unidades, treinos, eventos públicos e rodas) de GET /map/places. Não aceita null. */
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean({ message: 'mapVisible deve ser true ou false.' })
  mapVisible?: boolean;

  /** Aviso "Presença registrada" (push/sino) ao aluno e responsáveis quando a chamada o marca presente. false desliga. Não aceita null. */
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean({ message: 'attendanceNotifications deve ser true ou false.' })
  attendanceNotifications?: boolean;

  /** `null` ou `{}` (sem nenhuma rede) => coluna volta a NULL; objeto com redes => substitui por inteiro. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OrganizationSocialLinksDto)
  socialLinks?: OrganizationSocialLinksDto | null;
}
