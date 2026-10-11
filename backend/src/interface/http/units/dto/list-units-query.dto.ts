import { RecordStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';

/** Filtros de GET /units: paginação (limit/offset), q (busca no nome) e status (ACTIVE|INACTIVE). */
export class ListUnitsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
