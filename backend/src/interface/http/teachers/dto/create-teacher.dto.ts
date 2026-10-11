import { OrgRole } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/** "Professor" é papel (MESTRE ou PROFESSOR) de um OrganizationUser — não existe tabela
 * própria (ver TeachersService). Criar um professor cria o User + a membership juntos. */
export class CreateTeacherDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  /** Mesma política da senha do MESTRE (SSOT: @IsNewPassword). */
  @IsNewPassword()
  password!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsIn([OrgRole.MESTRE, OrgRole.PROFESSOR])
  role!: OrgRole;
}
