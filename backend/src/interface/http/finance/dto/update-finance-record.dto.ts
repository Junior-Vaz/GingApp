import { FinancialStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Todos os campos opcionais (update parcial) — sem @nestjs/mapped-types por consistência com
 * UpdateStudentDto; os validadores são os mesmos de CreateFinanceRecordDto, mais status/paidAt. */
export class UpdateFinanceRecordDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  studentId?: number;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsEnum(FinancialStatus)
  status?: FinancialStatus;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
