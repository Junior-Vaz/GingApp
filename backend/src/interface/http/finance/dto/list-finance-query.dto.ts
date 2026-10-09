import { FinancialStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/**
 * Filtros de GET /finance (e de GET /finance/summary, que ignora limit/offset).
 * `status` usa o status EFETIVO (mesma regra do painel): PENDING com vencimento anterior a hoje
 * conta como OVERDUE. `from`/`to` filtram o vencimento (data civil, inclusivo). `q` busca em
 * descrição e tipo.
 */
export class ListFinanceQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(FinancialStatus)
  status?: FinancialStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  studentId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}