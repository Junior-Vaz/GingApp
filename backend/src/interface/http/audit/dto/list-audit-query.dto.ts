import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { LimitOffsetQueryDto } from '../../../../shared/pagination/pagination';

/**
 * Filtros de GET /audit-logs (plataforma) e GET /audit-logs/me-group (Mestre).
 * `from`/`to`: data/hora ISO (so a data = dia civil inclusivo). `action`/`entity`: codigos do catalogo
 * (shared/audit/audit-actions.ts). No /me-group `organizationId` e' IGNORADO (o grupo vem SEMPRE do token).
 */
export class ListAuditQueryDto extends LimitOffsetQueryDto {
  /** Grupo (so a plataforma; no /me-group o grupo e' sempre o do token). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organizationId?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,60}$/, { message: 'action invalida.' })
  action?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_]{1,60}$/, { message: 'entity invalida.' })
  entity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
