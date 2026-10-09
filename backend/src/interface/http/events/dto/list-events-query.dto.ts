import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { EVENT_TYPES } from './event-type';

/** Ordens de GET /events por data. Sem `order`, vale a ordem histórica (id desc = cadastrados
 * mais recentemente primeiro), da qual o painel depende. */
export const EVENT_ORDERS = ['asc', 'desc'] as const;

/** Filtros de GET /events: tipo, intervalo de data (from/to, datas civis inclusivas), `q`
 * (título/local) e `order` (ordenação por data). */
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

  /** `asc` = data crescente (mais próximos primeiro, desempate por id asc); `desc` = data
   * decrescente (id desc). Ausente = id desc. Ordens totais e estáveis: a paginação não repete
   * nem perde itens. */
  @IsOptional()
  @IsIn(EVENT_ORDERS)
  order?: (typeof EVENT_ORDERS)[number];
}
