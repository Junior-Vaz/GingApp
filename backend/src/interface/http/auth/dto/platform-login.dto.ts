import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../../shared/security/password-policy';

/** Login exclusivo da equipe interna GingApp (userType = 'PLATFORM'). */
export class PlatformLoginDto {
  /** Normalizado antes de validar: " Mestre@X.com " loga como "mestre@x.com" (e-mails são gravados em minúsculas). */
  @Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}
