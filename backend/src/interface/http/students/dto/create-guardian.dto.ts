import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

/**
 * Corpo de POST /students/:id/guardians. NÃO aceita consentPublicProfile: o consentimento do perfil
 * público só é dado pelo próprio responsável, no fluxo do Passaporte (PATCH /passport/guardian-consent) —
 * o whitelist global (forbidNonWhitelisted) devolve 400 se vier.
 *
 * `createAccount` cria (ou vincula, se o e-mail já é usuário do sistema) o login RESPONSAVEL; exige `email`
 * e, para um e-mail novo, a senha provisória `password` (@IsNewPassword).
 */
export class CreateGuardianDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationship?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  createAccount?: boolean;

  @IsOptional()
  @IsNewPassword()
  password?: string;

  /** Convite por e-mail (só com SMTP ativo): o responsável define a PRÓPRIA senha pelo link; não informe `password`. */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;
}
