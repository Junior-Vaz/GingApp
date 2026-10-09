import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Paginação das listagens, COMPATÍVEL com o que já existia: o corpo da resposta continua sendo
 * um array e, sem `limit`, o tamanho continua 50 (o `take: 50` antigo). Quem quer mais passa
 * `limit` (até 200) e `offset`; o total de registros que casam com o filtro vem no header
 * `X-Total-Count` (exposto no CORS em main.ts) para a UI paginar/avisar sem mudar o formato.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const TOTAL_COUNT_HEADER = 'X-Total-Count';

/** DTO base das queries de listagem; cada módulo estende com os seus filtros (status, datas...). */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /** Busca textual (cada módulo decide em quais campos). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Argumentos `take`/`skip` do Prisma a partir da query. */
export function pageArgs(query: Pick<PageQueryDto, 'limit' | 'offset'>): { take: number; skip: number } {
  return { take: query.limit ?? DEFAULT_PAGE_SIZE, skip: query.offset ?? 0 };
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** Escreve o total no header e devolve só os itens (o corpo segue sendo um array). */
export function sendPage<T>(res: { setHeader(name: string, value: string): unknown }, page: Page<T>): T[] {
  res.setHeader(TOTAL_COUNT_HEADER, String(page.total));
  return page.items;
}
