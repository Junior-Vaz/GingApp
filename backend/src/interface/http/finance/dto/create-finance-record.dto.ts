import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateFinanceRecordDto {
  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsInt()
  studentId?: number;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  type?: string;
}
