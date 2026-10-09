import { StudentStatus } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

/**
 * Update parcial. Semantica de PATCH: campo ausente = nao mexe; `null` = LIMPA a coluna (so nos
 * campos nulláveis no schema: unitId, birthDate, document, phone, email, photo, joinedAt).
 * Colunas obrigatorias (name, status) usam `@ValidateIf(v !== undefined)` em vez de
 * `@IsOptional()`, que deixaria `null` passar e o Prisma devolveria 500: aqui `null` falha a
 * validacao (400).
 */
export class UpdateStudentDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  unitId?: number | null;

  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @IsString()
  document?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  photo?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsDateString()
  joinedAt?: string | null;
}