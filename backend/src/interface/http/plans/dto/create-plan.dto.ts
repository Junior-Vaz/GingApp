import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  code!: string;

  @IsInt()
  @Min(0)
  priceCents!: number;

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
