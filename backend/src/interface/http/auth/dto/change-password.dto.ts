import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/**
 * Troca da PRÓPRIA senha (POST /auth/change-password), para qualquer usuário autenticado (MEMBER ou
 * PLATFORM). Nenhum dos dois campos é aparado (espaços podem fazer parte da senha) e nenhum é logado
 * nem devolvido.
 */
export class ChangePasswordDto {
  /** Sem política (só limites sanos): contas antigas podem ter senhas que a política nova recusaria. */
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  currentPassword!: string;

  @IsNewPassword()
  newPassword!: string;
}
