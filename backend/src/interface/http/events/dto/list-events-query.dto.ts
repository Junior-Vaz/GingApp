import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { EVENT_TYPES } from './event-type';

/** Filtros de GET /events: tipo, intervalo de data (from/to, datas civis inclusivas) e `q`
 * (título/local). */
export class ListEventsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
