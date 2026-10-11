import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/**
 * Filtros de GET /finance/delinquents (e de /delinquents/summary, que ignora limit/offset).
 * `q` busca no nome do aluno; `from`/`to` filtram o vencimento (data civil, inclusivo); `unitId` é a
 * unidade do ALUNO.
 */
export class ListDelinquentsQueryDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  studentId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  unitId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
