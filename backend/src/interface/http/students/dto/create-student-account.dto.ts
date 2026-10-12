import { IsBoolean, IsEmail, IsOptional } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/**
 * Corpo de POST /students/:id/account (acesso do aluno) e de POST /students/:id/guardians/:guardianId/account. `email` cai para o e-mail do cadastro do aluno
 * quando omitido. `password` é a senha PROVISÓRIA (mesma política da senha do MESTRE — @IsNewPassword) e só
 * é exigida/usada quando o e-mail ainda não é usuário do sistema; ao vincular um usuário existente é
 * ignorada (a senha dele nunca é alterada por aqui). Nunca devolvida nem logada.
 */
export class CreateStudentAccountDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsNewPassword()
  password?: string;

  /**
   * Convite por e-mail (opcional; só com SMTP ativo): em vez de senha provisória, a pessoa recebe um link para
   * definir a PRÓPRIA senha. Não combina com `password`. O fluxo padrão (senha provisória) segue inalterado.
   */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}
