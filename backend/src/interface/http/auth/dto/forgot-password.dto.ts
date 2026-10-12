import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../../../shared/security/password-policy';

/** POST /auth/forgot-password. `organizationSlug` só desempata quando o e-mail tem vínculo em mais de um grupo. */
export class ForgotPasswordDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString({ message: 'O grupo (organizationSlug) deve ser um texto.' })
  @MaxLength(100)
  organizationSlug?: string;
}
