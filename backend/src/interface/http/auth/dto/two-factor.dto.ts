import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Tira espacos do que o usuario digitou ("123 456" -> "123456"). */
const stripSpaces = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.replace(/\s+/g, '') : value);

const CODE_MESSAGE = 'O código deve ter 6 dígitos.';

/** POST /auth/2fa/enable */
export class EnableTwoFactorDto {
  @Transform(stripSpaces)
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code!: string;
}

/** POST /auth/2fa/disable: senha + (code OU recoveryCode). */
export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  password!: string;

  @IsOptional()
  @Transform(stripSpaces)
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}

/** POST /auth/2fa/verify: o desafio devolvido pelo login + (code OU recoveryCode). */
export class VerifyTwoFactorDto {
  @IsString({ message: 'Informe o desafio de verificação.' })
  @MaxLength(2000)
  challengeToken!: string;

  @IsOptional()
  @Transform(stripSpaces)
  @Matches(/^\d{6}$/, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}
