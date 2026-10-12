import { StudentStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsImageRef } from '../../../../shared/uploads/image-ref';

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

  /** CPF do aluno (com ou sem máscara). Validado (400 INVALID_CPF) e usado para nunca duplicar a pessoa (ficha única). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  document?: string;

  /** CPF do RESPONSÁVEL, para criança sem CPF (exige birthDate): a ficha é identificada por CPF do responsável + nascimento. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  guardianDocument?: string;

  /** Código GingApp de quem já tem ficha (GING-XXXX-XXXX). */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  gingappCode?: string;

  /** true = cadastra mesmo havendo POSSIBLE_DUPLICATE (fica na auditoria). */
  @IsOptional()
  @IsBoolean()
  confirmNew?: boolean;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsImageRef()
  photo?: string;

  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @IsDateString()
  joinedAt?: string;
}
