import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /rodas (lista PÚBLICA, de todas as organizações): estado, cidade e `q`
 * (título/local). */
export class ListRodasQueryDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stateId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;
}
