import { FinancialStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

/** Todos os campos opcionais (update parcial) — sem @nestjs/mapped-types por consistência com
 * UpdateStudentDto; os validadores são os mesmos de CreateFinanceRecordDto, mais status/paidAt.
 *
 * Limpar campo: `null` grava NULL. Só as colunas NULLÁVEIS aceitam null (studentId, unitId, type,
 * paidAt — @IsOptional já deixa o null passar). As OBRIGATÓRIAS (description, amountCents,
 * dueDate, status) usam `@ValidateIf(v !== undefined)`: ausente = não muda; null = 400. */
export class UpdateFinanceRecordDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  description?: string;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  amountCents?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  studentId?: number | null;

  @IsOptional()
  @IsInt()
  unitId?: number | null;

  @IsOptional()
  @IsString()
  type?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(FinancialStatus)
  status?: FinancialStatus;

  @IsOptional()
  @IsDateString()
  paidAt?: string | null;
}