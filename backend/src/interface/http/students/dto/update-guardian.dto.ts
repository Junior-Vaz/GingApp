import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Update parcial do responsável. Campo ausente = não mexe; `null` limpa (relationship, phone, email).
 * `name` é obrigatório no schema: `null` falha a validação (400). Não aceita consentPublicProfile nem
 * dados de acesso (para isso: POST .../account e POST .../reset-password).
 */
export class UpdateGuardianDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  relationship?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;
}
