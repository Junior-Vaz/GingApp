import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { sendCsv, fileDate } from '../../../shared/csv/csv';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { ImportStudentsDto } from './dto/import-students.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import { StudentTransferService } from './student-transfer.service';

/**
 * Importação/exportação CSV de alunos. IMPORTANTE: precisa vir ANTES do StudentsController na lista `controllers`
 * do módulo — senão `GET /students/export.csv` cairia em `GET /students/:id` (ParseIntPipe => 400).
 */
@Controller('students')
export class StudentTransferController {
  constructor(
    private readonly transfer: StudentTransferService,
    private readonly audit: AuditService,
  ) {}

  /** Planilha dos alunos sob os filtros da lista (status, unitId, q) e o escopo de unidade do usuário. */
  @Get('export.csv')
  @CanAccess('students', 'view')
  async exportCsv(
    @CurrentOrganization() organizationId: number,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListStudentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, total } = await this.transfer.exportCsv(organizationId, query, user);
    await this.audit.record({
      organizationId,
      action: AuditAction.STUDENT_EXPORT,
      entity: AuditEntity.STUDENT,
      meta: { total, status: query.status ?? null, unitId: query.unitId ?? null, hasSearch: !!query.q },
    });
    return sendCsv(res, `alunos-${fileDate()}.csv`, csv, total);
  }

  /**
   * Importa alunos a partir de linhas já parseadas no painel (máx. 500). `dryRun: true` só valida. Só o MESTRE
   * (criação em massa) — além do `students:create` da matriz. Erros por linha no corpo; idempotente.
   */
  @Post('import')
  @UseGuards(MestreOnlyGuard)
  @CanAccess('students', 'create')
  @HttpCode(HttpStatus.OK)
  async importStudents(@CurrentOrganization() organizationId: number, @Body() dto: ImportStudentsDto) {
    const result = await this.transfer.importRows(organizationId, dto);
    // A simulacao (dryRun) nao altera nada: so a importacao de verdade entra na trilha.
    if (!result.dryRun) {
      await this.audit.record({
        organizationId,
        action: AuditAction.STUDENT_IMPORT,
        entity: AuditEntity.STUDENT,
        meta: { total: result.total, created: result.created, ignored: result.ignored, failed: result.failed },
      });
    }
    return result;
  }
}
