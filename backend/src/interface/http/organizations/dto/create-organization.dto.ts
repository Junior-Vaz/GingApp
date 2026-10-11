import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';
import { NEW_PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES } from '../../../../shared/security/password-policy';

/** Política de senha inicial do MESTRE: 12..72 (72 = limite do bcrypt, que ignora o excedente).
 * SSOT em shared/security/password-policy.ts (a mesma do reset e da troca da própria senha). */
export const MESTRE_PASSWORD_MIN_LENGTH = NEW_PASSWORD_MIN_LENGTH;
export const MESTRE_PASSWORD_MAX_BYTES = PASSWORD_MAX_BYTES;

/** Slug explícito: minúsculas/dígitos separados por hífen simples (sem acento, espaço nem "_"). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** CPF (11 dígitos) ou CNPJ (14), com ou sem pontuação. Formato apenas — dígito verificador não é checado. */
export const DOCUMENT_PATTERN = /^(?:\d{11}|\d{14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/;
export const PHONE_PATTERN = /^\+?[0-9()\-.\s]{8,30}$/;

/** Remove espaços nas pontas de strings; qualquer outro tipo passa intacto (a validação reprova). */
export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateMestreDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'email deve ser um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  /** NÃO é aparado (espaços podem fazer parte da senha) e NUNCA é devolvido nem logado.
   * Política SSOT (@IsNewPassword). */
  @IsNewPassword()
  password!: string;
}

export class CreateOrganizationDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name!: string;

  /** Opcional: sem ele o slug é gerado do nome (kebab-case sem acento; sufixo numérico em colisão). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(SLUG_PATTERN, { message: 'slug deve conter apenas letras minúsculas, números e hífens (ex.: grupo-ginga).' })
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(DOCUMENT_PATTERN, { message: 'document deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).' })
  document?: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'email deve ser um e-mail válido.' })
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone deve ter de 8 a 30 caracteres entre dígitos, +, (), - e espaço.' })
  phone?: string;

  // IsObject: sem ele, ValidateNested deixa passar `mestre` ausente (e o service estouraria em 500).
  @IsObject({ message: 'mestre é obrigatório (name, email e password do MESTRE).' })
  @ValidateNested()
  @Type(() => CreateMestreDto)
  mestre!: CreateMestreDto;
}
