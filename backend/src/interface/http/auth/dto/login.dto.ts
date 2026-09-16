import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Login de usuários userType = 'MEMBER' (mestre/professor/aluno/responsável).
 *
 * organizationSlug é opcional: só é exigido quando o e-mail tem membership ativo em mais
 * de uma organização (decisão de modelagem — o plano não detalha como o usuário escolhe o
 * contexto de organização no login quando pertence a vários grupos).
 */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  organizationSlug?: string;
}
