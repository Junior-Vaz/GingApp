import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { AnonymizationService } from './anonymization.service';
import { AnonymizeDataDeletionRequestDto } from './dto/anonymize-data-deletion-request.dto';
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
  constructor(
    private readonly service: DataDeletionRequestsService,
    private readonly anonymization: AnonymizationService,
  ) {}

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

  /** LGPD: anonimiza a ficha/matriculas/login de quem pediu (IRREVERSIVEL) e marca o pedido DONE. Super admin ativo. */
  @Post(':id/anonymize')
  @UseGuards(SuperAdminGuard)
  @HttpCode(200)
  async anonymize(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
    @Body() _dto: AnonymizeDataDeletionRequestDto,
  ) {
    const result = await this.anonymization.anonymizeRequest(id, actorId);
    return { request: await this.service.findOne(id), result };
  }
}
