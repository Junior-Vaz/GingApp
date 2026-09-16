import { StudentStatus } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/** Todos os campos opcionais (update parcial) — sem @nestjs/mapped-types para não adicionar
 * dependência só para isso; os validadores são os mesmos de CreateStudentDto. */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  photo?: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;
}
