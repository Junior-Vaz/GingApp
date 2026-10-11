import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsNewPassword } from '../../../../shared/security/new-password.decorator';

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

  /** Política SSOT da senha nova (@IsNewPassword): 12..72 bytes, sem Dev@12345 — a mesma de POST /teachers e do MESTRE. */
  @IsNewPassword()
  password!: string;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean;
}
