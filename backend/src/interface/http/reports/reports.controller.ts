import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { fileDate, sendCsv } from '../../../shared/csv/csv';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { AttendanceReportQueryDto, ReportPeriodQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * Relatórios (I03). NÃO existe o recurso `reports` na matriz RolePermission: cada relatório exige o `view` do recurso
 * de onde vêm os dados (attendance, students, graduations, finance). Assim o financeiro continua só do MESTRE, o
 * PROFESSOR vê os demais (já restritos às suas unidades) e ALUNO/RESPONSAVEL não veem nenhum — sem migration nem
 * linha nova de permissão.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  /** Presença por turma e por aluno + % no período (padrão: últimos 30 dias). */
  @Get('attendance')
  @CanAccess('attendance', 'view')
  attendance(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceReportQueryDto,
  ) {
    return this.reports.attendance(organizationId, query, user);
  }

  /** Frequência por aluno em CSV (mesmos filtros: from, to, classId, unitId). */
  @Get('attendance/export.csv')
  @CanAccess('attendance', 'view')
  async attendanceCsv(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, total } = await this.reports.attendanceCsv(organizationId, query, user);
    await this.audit.record({
      organizationId,
      action: AuditAction.REPORT_EXPORT,
      entity: AuditEntity.REPORT,
      entityId: 'attendance',
      meta: { total },
    });
    return sendCsv(res, `frequencia-${fileDate()}.csv`, csv, total);
  }

  /** Receita recebida, a receber e inadimplência por mês de vencimento (padrão: 6 meses até o fim do mês atual). */
  @Get('finance')
  @CanAccess('finance', 'view')
  finance(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportPeriodQueryDto,
  ) {
    return this.reports.finance(organizationId, query, user);
  }

  /** Alunos: situação, novos por mês, por unidade e faixa etária (padrão: últimos 12 meses). */
  @Get('students')
  @CanAccess('students', 'view')
  students(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportPeriodQueryDto,
  ) {
    return this.reports.students(organizationId, query, user);
  }

  /** Graduações por mês e por nível/corda (padrão: últimos 12 meses). */
  @Get('graduations')
  @CanAccess('graduations', 'view')
  graduations(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ReportPeriodQueryDto,
  ) {
    return this.reports.graduations(organizationId, query, user);
  }
}
