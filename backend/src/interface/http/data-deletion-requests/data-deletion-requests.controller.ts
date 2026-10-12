import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { DataDeletionRequestsService, DataDeletionRequestView } from './data-deletion-requests.service';
import { ListDataDeletionRequestsQueryDto } from './dto/list-data-deletion-requests-query.dto';
import { UpdateDataDeletionRequestDto } from './dto/update-data-deletion-request.dto';

/**
 * Pedidos de exclusao de dados (LGPD) — exclusivo da equipe PLATFORM. Listar (GET): qualquer PLATFORM. Tratar (PATCH):
 * so' super admin ATIVO (mesma regra das configuracoes globais). Corpo da lista = array; total em X-Total-Count.
 */
@Controller('data-deletion-requests')
@UseGuards(PlatformOnlyGuard)
export class DataDeletionRequestsController {
  constructor(private readonly service: DataDeletionRequestsService) {}

  @Get()
  async findAll(
    @Query() query: ListDataDeletionRequestsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DataDeletionRequestView[]> {
    return sendPage(res, await this.service.findAll(query));
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDataDeletionRequestDto,
  ): Promise<DataDeletionRequestView> {
    return this.service.update(id, dto);
  }
}
