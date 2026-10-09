import { RecordStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsOptional } from 'class-validator';
import { LimitOffsetQueryDto } from '../../../../shared/pagination/pagination';

/**
 * Filtros de GET /lessons/me: limit/offset (padrão 50, teto 200; total em X-Total-Count),
 * from/to = intervalo INCLUSIVO da data da aula (YYYY-MM-DD; `to` só com data inclui o dia todo),
 * status e ordem por data (`asc` = padrão histórico, "próxima aula" no topo; `desc` = mais
 * recentes primeiro, para "aulas anteriores").
 */
export class ListMyLessonsQueryDto extends LimitOffsetQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
