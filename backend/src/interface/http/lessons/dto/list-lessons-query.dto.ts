import { RecordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /lessons: classId, status, from/to (intervalo inclusivo em `date`) e q (observacoes). */
export class ListLessonsQueryDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  classId?: number;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Ordenacao por data da aula: 'asc' / 'desc' ou 'nearest' (de hoje em diante, da mais proxima para a mais distante;
   * depois as passadas, da mais recente para a mais antiga). Omitido = comportamento antigo (mais recentemente criada primeiro).
   */
  @IsOptional()
  @IsIn(['asc', 'desc', 'nearest'])
  order?: 'asc' | 'desc' | 'nearest';
}