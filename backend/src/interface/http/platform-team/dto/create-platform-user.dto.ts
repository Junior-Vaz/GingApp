import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX_BYTES } from '../../../../shared/security/password-policy';

/** Tamanho máximo da senha: o bcrypt só considera os primeiros 72 bytes. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = PASSWORD_MAX_BYTES;

export class CreatePlatformUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean;
}
