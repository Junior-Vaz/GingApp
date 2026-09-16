import { RecordStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** Todos os campos opcionais (update parcial) — sem @nestjs/mapped-types para não adicionar
 * dependência só para isso; os validadores são os mesmos de CreateClassDto. */
export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
