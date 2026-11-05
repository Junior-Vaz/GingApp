import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { sendCsv } from '../../../shared/csv/csv';
import { PageQueryDto } from '../../../shared/pagination/pagination';
import {
  CreateSponsorCampaignDto,
  CreateSponsorDto,
  PlatformListSponsorCampaignsQueryDto,
  PlatformListSponsorsQueryDto,
  SponsorReasonDto,
  SponsorReportQueryDto,
  UpdateSponsorCampaignDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { PlatformSponsorsService } from './platform-sponsors.service';

/**
 * Patrocinadores (equipe da PLATAFORMA, admin.gingapp.com.br). Prefixo na convencao do projeto para rotas de plataforma
 * (`platform-team`, `platform-settings`, `platform-announcements`): /platform-sponsors. Contrato 4.3.
 * Listas: corpo = array + total em X-Total-Count (?q=&limit=&offset=), como o resto do projeto. Por padrao SO os da
 * plataforma; `?scope=GROUP[&organizationId=]` lista os dos grupos (supervisao, contrato do grupo secao 4). Leitura por id
 * aceita patrocinador de grupo; editar/excluir patrocinador de grupo = 404 (e do Mestre).
 */
@Controller('platform-sponsors')
@UseGuards(PlatformOnlyGuard)
export class PlatformSponsorsController {
  constructor(private readonly service: PlatformSponsorsService) {}

  @Get()
  async list(@Query() query: PlatformListSponsorsQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.listSponsors(query));
  }

  @Post()
  create(@Body() dto: CreateSponsorDto) {
    return this.service.createSponsor(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.getSponsor(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSponsorDto) {
    return this.service.updateSponsor(id, dto);
  }

  /** 409 SPONSOR_HAS_CAMPAIGNS se houver campanhas. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.deleteSponsor(id);
  }
}

/**
 * Campanhas de patrocinio (equipe da PLATAFORMA): /platform-sponsor-campaigns. Ativar = SO super admin ativo
 * (SuperAdminGuard, 403 antes de qualquer validacao); pausar/retomar/editar = qualquer usuario PLATFORM.
 * Leituras trazem `effectiveStatus` (DRAFT | PAUSED | SCHEDULED | ACTIVE_NOW | ENDED).
 */
@Controller('platform-sponsor-campaigns')
@UseGuards(PlatformOnlyGuard)
export class PlatformSponsorCampaignsController {
  constructor(private readonly service: PlatformSponsorsService) {}

  /**
   * Filtros: status, sponsorId, effective, q (titulo/patrocinador/host); paginado (X-Total-Count). Padrao = so plataforma;
   * `?scope=GROUP[&organizationId=]` = campanhas dos grupos (somente leitura, com organization e platformSuspended).
   */
  @Get()
  async list(@Query() query: PlatformListSponsorCampaignsQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.listCampaigns(query));
  }

  @Post()
  create(@Body() dto: CreateSponsorCampaignDto) {
    return this.service.createCampaign(dto);
  }

  /** CSV do relatorio (UTF-8 com BOM, ';'). Antes de ':id/report' so por clareza (caminhos distintos). */
  @Get(':id/report.csv')
  async reportCsv(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SponsorReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.service.reportCsv(id, query);
    return sendCsv(res, filename, csv);
  }

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (opcionais, inclusivos, dia de Sao Paulo). */
  @Get(':id/report')
  report(@Param('id', ParseIntPipe) id: number, @Query() query: SponsorReportQueryDto) {
    return this.service.report(id, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.getCampaign(id);
  }

  /** Editar CONTEUDO de campanha ACTIVE/PAUSED a volta para DRAFT (nova aprovacao). */
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSponsorCampaignDto) {
    return this.service.updateCampaign(id, dto);
  }

  /** Apaga a campanha e as estatisticas dela. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.deleteCampaign(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @UseGuards(SuperAdminGuard)
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: number) {
    return this.service.activate(id, userId);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseIntPipe) id: number) {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseIntPipe) id: number) {
    return this.service.resume(id);
  }

  /** Suspende campanha de GRUPO (qualquer PLATFORM; `{ reason }` 3..300): para de ser servida na hora; o Mestre nao retoma. */
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: number, @Body() dto: SponsorReasonDto) {
    return this.service.suspend(id, userId, dto);
  }

  /** Levanta a suspensao (SO super admin): a campanha fica PAUSED/DRAFT para o Mestre decidir retomar. */
  @Post(':id/unsuspend')
  @HttpCode(200)
  @UseGuards(SuperAdminGuard)
  unsuspend(@Param('id', ParseIntPipe) id: number, @Body() dto: SponsorReasonDto) {
    return this.service.unsuspend(id, dto);
  }
}

/**
 * Patrocinio LOCAL dos grupos visto pela PLATAFORMA (contrato do grupo secao 4): lista dos grupos com patrocinadores/
 * campanhas e bloqueio/liberacao do grupo todo (SO super admin, `{ reason }` 3..300 para bloquear).
 */
@Controller('platform-sponsor-groups')
@UseGuards(PlatformOnlyGuard)
export class PlatformSponsorGroupsController {
  constructor(private readonly service: PlatformSponsorsService) {}

  @Get()
  async list(@Query() query: PageQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.listGroups(query));
  }

  @Post(':organizationId/block')
  @HttpCode(200)
  @UseGuards(SuperAdminGuard)
  block(@Param('organizationId', ParseIntPipe) organizationId: number, @Body() dto: SponsorReasonDto) {
    return this.service.blockGroup(organizationId, dto);
  }

  @Post(':organizationId/unblock')
  @HttpCode(200)
  @UseGuards(SuperAdminGuard)
  unblock(@Param('organizationId', ParseIntPipe) organizationId: number, @Body() dto: SponsorReasonDto) {
    return this.service.unblockGroup(organizationId, dto);
  }
}
