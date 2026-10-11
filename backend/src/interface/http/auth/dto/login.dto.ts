import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { normalizeEmail } from '../../../../shared/security/password-policy';

/**
 * Login de usuários userType = 'MEMBER' (mestre/professor/aluno/responsável).
 *
 * organizationSlug é opcional: só é exigido quando o e-mail tem membership ativo em mais
 * de uma organização (decisão de modelagem — o plano não detalha como o usuário escolhe o
 * contexto de organização no login quando pertence a vários grupos).
 */
export class LoginDto {
  /** Normalizado antes de validar: " Mestre@X.com " loga como "mestre@x.com" (e-mails são gravados em minúsculas). */
  @Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email!: string;

  @IsString({ message: 'Informe a senha.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password!: string;

  @IsOptional()
  @IsString({ message: 'O grupo (organizationSlug) deve ser um texto.' })
  organizationSlug?: string;
}
