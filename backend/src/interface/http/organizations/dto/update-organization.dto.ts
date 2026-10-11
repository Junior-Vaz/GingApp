import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { DOCUMENT_PATTERN, PHONE_PATTERN, trim } from './create-organization.dto';

/**
 * PATCH /organizations/:id — update parcial. As validações são as mesmas do CreateOrganizationDto
 * (reaproveitando os mesmos padrões). O slug é IMUTÁVEL: não existe aqui e o ValidationPipe global
 * (forbidNonWhitelisted) responde 400 se vier. `name` não aceita null; document/email/phone aceitam
 * null para limpar o campo.
 */
export class UpdateOrganizationDto {
  @ValidateIf((o: UpdateOrganizationDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'name deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(DOCUMENT_PATTERN, { message: 'document deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).' })
  document?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'email deve ser um e-mail válido.' })
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone deve ter de 8 a 30 caracteres entre dígitos, +, (), - e espaço.' })
  phone?: string | null;
}
