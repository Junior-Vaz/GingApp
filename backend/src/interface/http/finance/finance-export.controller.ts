import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { RequireFeature } from '../../../shared/decorators/require-feature.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { fileDate, sendCsv } from '../../../shared/csv/csv';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { ListDelinquentsQueryDto } from './dto/list-delinquents-query.dto';
import { ListFinanceQueryDto } from './dto/list-finance-query.dto';
import { FinanceExportService } from './finance-export.service';

/**
 * Exportações CSV do financeiro (mesmo RBAC do recurso `finance`: só o MESTRE). Precisa vir ANTES do
 * FinanceController na lista `controllers` do módulo — senão `export.csv` cairia em `GET /finance/:id`.
 */
@RequireFeature('finance')
@Controller('finance')
export class FinanceExportController {
  constructor(
    private readonly exporter: FinanceExportService,
    private readonly audit: AuditService,
  ) {}

  /** Lançamentos sob os filtros da tela (status, studentId, from, to, q). */
  @Get('export.csv')
  @CanAccess('finance', 'view')
  async exportRecords(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, total } = await this.exporter.exportRecords(organizationId, query, user);
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_EXPORT,
      entity: AuditEntity.FINANCE,
      meta: { kind: 'lancamentos', total },
    });
    return sendCsv(res, `financeiro-lancamentos-${fileDate()}.csv`, csv, total);
  }

  /** Inadimplentes sob os filtros da aba (q, unitId, from, to). */
  @Get('delinquents/export.csv')
  @CanAccess('finance', 'view')
  async exportDelinquents(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListDelinquentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, total } = await this.exporter.exportDelinquents(organizationId, query);
    await this.audit.record({
      organizationId,
      action: AuditAction.FINANCE_EXPORT,
      entity: AuditEntity.FINANCE,
      meta: { kind: 'inadimplentes', total },
    });
    return sendCsv(res, `financeiro-inadimplentes-${fileDate()}.csv`, csv, total);
  }
}
