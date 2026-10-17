import { StudentStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
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

  /**
   * Cadastro rápido: já cria o LOGIN do aluno (como POST /students/:id/account, com senha provisória GERADA pelo
   * servidor e troca obrigatória no 1º acesso). Exige o e-mail do aluno e a permissão de criar acesso; sem uma das
   * duas o aluno é criado normalmente e `access.status` explica (SKIPPED_NO_EMAIL / SKIPPED_NO_PERMISSION).
   */
  @IsOptional()
  @IsBoolean()
  createAccess?: boolean;

  /** Cadastro rápido: turmas (do grupo e do escopo de unidade do usuário) em que o aluno já nasce matriculado. Máx. 10. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  classIds?: number[];
}
