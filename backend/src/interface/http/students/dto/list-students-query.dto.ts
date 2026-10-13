import { StaffRole, StudentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /students (alem de limit/offset/q): q busca em nome, e-mail, documento e telefone. */
export class ListStudentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  /** Fase 3: so alunos com este cargo ATIVO no grupo (MESTRE/PROFESSOR/INSTRUTOR/MONITOR). */
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  /** Ordenacao: 'name' = alfabetica (A-Z); 'recent' (padrao da API) = mais recentemente cadastrado primeiro. */
  @IsOptional()
  @IsIn(['name', 'recent'])
  order?: 'name' | 'recent';
}