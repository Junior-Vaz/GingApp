import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

/** Todos os campos opcionais (update parcial) — mesmo padrão de UpdateStudentDto: sem
 * @nestjs/mapped-types só para isso, validadores repetidos de CreatePlanDto. */
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxStudents?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
