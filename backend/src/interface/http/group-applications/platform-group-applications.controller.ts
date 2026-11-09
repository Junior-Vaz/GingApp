import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { ApproveGroupApplicationDto, ListGroupApplicationsQueryDto, RejectGroupApplicationDto } from './dto/group-application.dto';
import { GroupApplicationsService } from './group-applications.service';

/**
 * Pedidos de adesao para a equipe da plataforma (admin.gingapp.com.br; docs/CONTRATO_ADESAO_GRUPOS.md 4).
 * Ler: qualquer PLATFORM (PlatformOnlyGuard). Decidir (aprovar/rejeitar): SO super admin ATIVO (SuperAdminGuard, a mesma
 * barreira do POST /organizations; 403 antes de qualquer validacao). Listas: corpo = array + total em X-Total-Count.
 * Nenhuma resposta tem passwordHash nem token.
 */
@Controller('platform-group-applications')
@UseGuards(PlatformOnlyGuard)
export class PlatformGroupApplicationsController {
  constructor(private readonly service: GroupApplicationsService) {}

  /** ?status=&q=&limit=&offset= (PENDING primeiro, mais antigos primeiro; depois createdAt desc). */
  @Get()
  async list(@Query() query: ListGroupApplicationsQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.list(query));
  }

  /** Contador do menu do admin. Declarada ANTES de `:id` para "pending-count" nao cair no ParseIntPipe. */
  @Get('pending-count')
  pendingCount() {
    return this.service.pendingCount();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post(':id/approve')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApproveGroupApplicationDto, @CurrentUser('id') userId: number) {
    return this.service.approve(id, dto, userId);
  }

  @Post(':id/reject')
  @UseGuards(SuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectGroupApplicationDto, @CurrentUser('id') userId: number) {
    return this.service.reject(id, dto, userId);
  }
}
