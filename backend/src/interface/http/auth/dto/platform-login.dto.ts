import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../../shared/security/password-policy';

/** Login exclusivo da equipe interna GingApp (userType = 'PLATFORM'). */
export class PlatformLoginDto {
  /** Normalizado antes de validar: " Mestre@X.com " loga como "mestre@x.com" (e-mails são gravados em minúsculas). */
  @Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email!: string;

  @IsString({ message: 'Informe a senha.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password!: string;
}
