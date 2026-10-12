import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { PageQueryDto } from '../../../../shared/pagination/pagination';
import { DELETION_REQUEST_STATUSES, DeletionRequestStatus } from '../deletion-request-status';

/**
 * Filtros de GET /data-deletion-requests (plataforma): status, grupo (organizationId do momento do pedido), periodo do
 * pedido (`from`/`to`: so a data = dia civil inclusivo, UTC) e `q` (nome/e-mail do solicitante). Paginacao padrao.
 */
export class ListDataDeletionRequestsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(DELETION_REQUEST_STATUSES)
  status?: DeletionRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organizationId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
