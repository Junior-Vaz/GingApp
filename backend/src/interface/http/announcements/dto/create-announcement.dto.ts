import { OrgRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { BR_UFS } from '../../../../shared/geo/br-states';

const upperUf = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  body!: string;

  @IsOptional()
  @IsInt()
  unitId?: number;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  /** Alcance: só a turma (alunos matriculados, responsáveis e o professor). */
  @IsOptional()
  @IsInt()
  classId?: number;

  /** Alcance: só quem pertence a unidades desta UF (ex.: GO). */
  @IsOptional()
  @Transform(upperUf)
  @IsIn(BR_UFS, { message: 'stateUf deve ser a sigla de uma UF brasileira (ex.: GO, SP).' })
  stateUf?: string;

  /** Alcance: só um papel do grupo (ALUNO, RESPONSAVEL, PROFESSOR). Omitido = todos. */
  @IsOptional()
  @IsEnum(OrgRole)
  audienceRole?: OrgRole;
}
