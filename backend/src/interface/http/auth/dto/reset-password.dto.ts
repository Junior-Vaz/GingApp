import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/** POST /auth/reset-password. O token vem do link do e-mail; a senha segue a política @IsNewPassword (12..72 bytes). */
export class ResetPasswordDto {
  @IsString({ message: 'Link inválido ou expirado. Solicite um novo.' })
  @MinLength(20, { message: 'Link inválido ou expirado. Solicite um novo.' })
  @MaxLength(200, { message: 'Link inválido ou expirado. Solicite um novo.' })
  token!: string;

  @IsNewPassword()
  newPassword!: string;
}
