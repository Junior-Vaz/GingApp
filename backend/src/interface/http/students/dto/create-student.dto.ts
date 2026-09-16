import { StudentStatus } from '@prisma/client';
import { IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @MinLength(2)
  name!: string;

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
