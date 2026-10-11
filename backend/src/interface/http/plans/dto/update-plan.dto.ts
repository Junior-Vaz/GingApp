import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** `maxUnits`/`maxStudents` aceitam `null` para REMOVER o limite (ilimitado); quando não nulos: inteiro >= 1.
 * Todos os campos opcionais (update parcial) — mesmo padrão de UpdateStudentDto: sem
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
  @Max(2147483647)
  priceCents?: number;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maxUnits?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maxStudents?: number | null;

  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
