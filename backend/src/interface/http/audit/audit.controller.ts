import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { AuditLogView, AuditQueryService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

/**
 * Trilha de auditoria (somente leitura; a gravacao e' do AuditService em shared/audit).
 *  - GET /audit-logs          : equipe da plataforma (PlatformOnlyGuard) — todos os grupos, com filtros.
 *  - GET /audit-logs/me-group : Mestre (MestreOnlyGuard) — SOMENTE o proprio grupo (o grupo vem do token).
 * Corpo = array; o total em X-Total-Count (padrao das demais listagens).
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}

  @Get()
  @UseGuards(PlatformOnlyGuard)
  async listAll(
    @Query() query: ListAuditQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuditLogView[]> {
    return sendPage(res, await this.service.listAll(query));
  }

  @Get('me-group')
  @UseGuards(MestreOnlyGuard)
  async listMyGroup(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListAuditQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuditLogView[]> {
    return sendPage(res, await this.service.listGroup(organizationId, query));
  }
}
