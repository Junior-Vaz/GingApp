import { ApplicantRole, GroupApplicationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';
import { PHONE_PATTERN, SLUG_PATTERN, trim } from '../../organizations/dto/create-organization.dto';
import { INSTAGRAM_HANDLE_PATTERN, INSTAGRAM_INVALID_MESSAGE, normalizeInstagram } from '../group-application-rules';

/**
 * Instagram: normalizado para o handle puro (SSOT normalizeInstagram); vazio vira ausente. INVALIDO fica com o valor
 * recebido, que entao reprova no @Matches do handle (um texto que nao normaliza nunca casa com o padrao do handle).
 */
const instagram = ({ value }: { value: unknown }) => {
  const normalized = normalizeInstagram(value);
  if (normalized === null) return undefined;
  return normalized === undefined ? value : normalized;
};

/** Sigla da UF: aparada e em maiusculas (aceita "sp"); qualquer outro tipo passa intacto (a validacao reprova). */
const uf = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
/** E-mail: aparado e em minusculas (como e gravado e comparado). */
const lowerEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
/** Texto opcional: aparado; vazio vira undefined (nao grava ""). */
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

/**
 * Corpo do POST /public/group-applications (contrato secao 3). Mensagens em portugues e SEM o valor recebido.
 * `password` NAO e aparada (espacos podem fazer parte da senha) e nunca e devolvida, logada nem auditada.
 */
export class CreateGroupApplicationDto {
  @Transform(trim)
  @IsString({ message: 'applicantName deve ser um texto.' })
  @MinLength(2, { message: 'applicantName deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'applicantName deve ter no máximo 120 caracteres.' })
  applicantName!: string;

  @Transform(lowerEmail)
  @IsEmail({}, { message: 'email deve ser um e-mail válido.' })
  @MaxLength(254, { message: 'email deve ter no máximo 254 caracteres.' })
  email!: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString({ message: 'phone deve ser um texto.' })
  @Matches(PHONE_PATTERN, { message: 'phone deve ter de 8 a 30 caracteres entre dígitos, +, (), - e espaço.' })
  phone?: string;

  @IsNewPassword()
  password!: string;

  @IsEnum(ApplicantRole, { message: 'claimedRole deve ser MESTRE, CONTRAMESTRE, PROFESSOR, INSTRUTOR, MONITOR ou OUTRO.' })
  claimedRole!: ApplicantRole;

  @Transform(trim)
  @IsString({ message: 'groupName deve ser um texto.' })
  @MinLength(2, { message: 'groupName deve ter no mínimo 2 caracteres.' })
  @MaxLength(120, { message: 'groupName deve ter no máximo 120 caracteres.' })
  groupName!: string;

  @Transform(trim)
  @IsString({ message: 'city deve ser um texto.' })
  @MinLength(2, { message: 'city deve ter no mínimo 2 caracteres.' })
  @MaxLength(80, { message: 'city deve ter no máximo 80 caracteres.' })
  city!: string;

  @Transform(uf)
  @IsIn(BR_UFS, { message: 'state deve ser a sigla de uma UF brasileira (ex.: GO, SP, RJ).' })
  state!: string;

  @IsOptional()
  @IsInt({ message: 'estimatedStudents deve ser um número inteiro.' })
  @Min(0, { message: 'estimatedStudents deve ser no mínimo 0.' })
  @Max(100000, { message: 'estimatedStudents deve ser no máximo 100000.' })
  estimatedStudents?: number;

  @IsOptional()
  @Transform(optionalText)
  @IsString({ message: 'message deve ser um texto.' })
  @MaxLength(500, { message: 'message deve ter no máximo 500 caracteres.' })
  message?: string;

  @Equals(true, { message: 'acceptTerms deve ser true (aceite dos Termos de Uso e da Política de Privacidade).' })
  acceptTerms!: boolean;

  @Equals(true, { message: 'adult deve ser true (declaração de ter 18 anos ou mais).' })
  adult!: boolean;

  /**
   * Opcional (docs/CONTRATO_ADESAO_GRUPOS_EMAIL.md 7): `@meugrupo`, `meugrupo` ou o link do perfil; grava so o handle. So
   * a equipe ve (nunca na resposta publica nem em e-mail). Qualquer outra forma = 400 com mensagem unica.
   */
  @IsOptional()
  @Transform(instagram)
  @IsString({ message: INSTAGRAM_INVALID_MESSAGE })
  @Matches(INSTAGRAM_HANDLE_PATTERN, { message: INSTAGRAM_INVALID_MESSAGE })
  instagram?: string;

  /** Honeypot (campo invisivel do formulario): preenchido = robo (201 falso, nada gravado). Aceita qualquer texto curto. */
  @IsOptional()
  @IsString({ message: 'website deve ser um texto.' })
  @MaxLength(500, { message: 'website deve ter no máximo 500 caracteres.' })
  website?: string;
}

/** GET /platform-group-applications?status=&q=&limit=&offset= */
export class ListGroupApplicationsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(GroupApplicationStatus, { message: 'status deve ser UNVERIFIED, PENDING, APPROVED, REJECTED ou EXPIRED.' })
  status?: GroupApplicationStatus;
}

/**
 * POST /public/group-applications/confirm `{ token }` (token do LINK do e-mail, no corpo; nunca em query). Token mal
 * formado/inexistente/vencido/ja usado = o mesmo 404 (no service); aqui so o tipo e um teto de tamanho.
 */
export class ConfirmGroupApplicationEmailDto {
  @IsString({ message: 'token é obrigatório.' })
  @MaxLength(200, { message: 'token deve ter no máximo 200 caracteres.' })
  token!: string;
}

/** POST /platform-group-applications/:id/approve */
export class ApproveGroupApplicationDto {
  /** Opcional: sem ele o slug e gerado do nome do grupo (mesma regra do POST /organizations). */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'slug deve ser um texto.' })
  @MinLength(2, { message: 'slug deve ter no mínimo 2 caracteres.' })
  @MaxLength(60, { message: 'slug deve ter no máximo 60 caracteres.' })
  @Matches(SLUG_PATTERN, { message: 'slug deve conter apenas letras minúsculas, números e hífens (ex.: grupo-ginga).' })
  slug?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString({ message: 'internalNote deve ser um texto.' })
  @MaxLength(500, { message: 'internalNote deve ter no máximo 500 caracteres.' })
  internalNote?: string;
}

/** POST /platform-group-applications/:id/reject */
export class RejectGroupApplicationDto {
  /** Motivo que VAI para o solicitante (status publico e e-mail). */
  @Transform(trim)
  @IsString({ message: 'reason é obrigatório (de 3 a 300 caracteres).' })
  @MinLength(3, { message: 'reason deve ter no mínimo 3 caracteres.' })
  @MaxLength(300, { message: 'reason deve ter no máximo 300 caracteres.' })
  reason!: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString({ message: 'internalNote deve ser um texto.' })
  @MaxLength(500, { message: 'internalNote deve ter no máximo 500 caracteres.' })
  internalNote?: string;
}
