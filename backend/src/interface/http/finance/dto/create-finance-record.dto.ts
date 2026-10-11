import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateFinanceRecordDto {
  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  amountCents!: number;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsInt()
  @Max(2147483647)
  studentId?: number;

  @IsOptional()
  @IsInt()
  @Max(2147483647)
  unitId?: number;

  @IsOptional()
  @IsString()
  type?: string;
}
