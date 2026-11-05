import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { MestreOnlyGuard } from '../../../shared/guards/mestre-only.guard';
import { sendCsv } from '../../../shared/csv/csv';
import { sendPage } from '../../../shared/pagination/pagination';
import {
  AcceptSponsorTermsDto,
  CreateSponsorCampaignDto,
  CreateSponsorDto,
  ListSponsorCampaignsQueryDto,
  ListSponsorsQueryDto,
  SponsorReportQueryDto,
  UpdateSponsorCampaignDto,
  UpdateSponsorDto,
} from './dto/sponsor.dto';
import { GroupSponsorsService } from './group-sponsors.service';

/**
 * Patrocinadores LOCAIS do grupo pelo MESTRE (painel.gingapp.com.br; docs/CONTRATO_PATROCINADORES_GRUPO.md secao 3).
 * SO o papel MESTRE do grupo do token (MestreOnlyGuard: PROFESSOR/ALUNO/RESPONSAVEL/plataforma = 403 antes de validar o
 * corpo). Tudo filtrado pelo organizationId do token: id de outro grupo = 404. Listas = array + X-Total-Count.
 * Imagens: POST /group-sponsor-uploads (upload do proprio grupo otimizado ate 250 KB) ou POST /uploads (<= 250 KB).
 */
@Controller('group-sponsors')
@UseGuards(MestreOnlyGuard)
export class GroupSponsorsController {
  constructor(private readonly service: GroupSponsorsService) {}

  /** Termo vigente + se o grupo aceitou + bloqueio pela plataforma. */
  @Get('terms')
  terms(@CurrentOrganization() organizationId: number) {
    return this.service.terms(organizationId);
  }

  /** `{ version }` = a versao vigente (outra = 409 TERMS_VERSION_MISMATCH). */
  @Post('terms/accept')
  @HttpCode(200)
  acceptTerms(@CurrentOrganization() organizationId: number, @CurrentUser('id') userId: number, @Body() dto: AcceptSponsorTermsDto) {
    return this.service.acceptTerms(organizationId, userId, dto);
  }

  @Get()
  async list(@CurrentOrganization() organizationId: number, @Query() query: ListSponsorsQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.listSponsors(organizationId, query));
  }

  /** No maximo 10 patrocinadores por grupo (409 SPONSOR_LIMIT). */
  @Post()
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateSponsorDto) {
    return this.service.createSponsor(organizationId, dto);
  }

  @Get(':id')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.getSponsor(organizationId, id);
  }

  @Patch(':id')
  update(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSponsorDto) {
    return this.service.updateSponsor(organizationId, id, dto);
  }

  /** 409 SPONSOR_HAS_CAMPAIGNS se houver campanhas. */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.deleteSponsor(organizationId, id);
  }
}

/**
 * Campanhas do grupo pelo MESTRE: mesmos campos/validacoes da plataforma EXCETO `states` (so vazio) e `weight` (so 1).
 * Ativar: termo vigente aceito (403 SPONSOR_TERMS_REQUIRED), grupo nao bloqueado (403 SPONSORS_BLOCKED), nao suspensa
 * (403 SUSPENDED_BY_PLATFORM), valida e nao encerrada, no maximo 3 ativas (409 SPONSOR_LIMIT); grava o Mestre como aprovador.
 * Retomar suspensa pela plataforma = 403 SUSPENDED_BY_PLATFORM. Editar conteudo de ACTIVE/PAUSED volta a DRAFT.
 */
@Controller('group-sponsor-campaigns')
@UseGuards(MestreOnlyGuard)
export class GroupSponsorCampaignsController {
  constructor(private readonly service: GroupSponsorsService) {}

  /** Filtros: effective, sponsorId, status, q; paginado (X-Total-Count). */
  @Get()
  async list(
    @CurrentOrganization() organizationId: number,
    @Query() query: ListSponsorCampaignsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.service.listCampaigns(organizationId, query));
  }

  /** No maximo 10 campanhas por grupo (409 SPONSOR_LIMIT). */
  @Post()
  create(@CurrentOrganization() organizationId: number, @Body() dto: CreateSponsorCampaignDto) {
    return this.service.createCampaign(organizationId, dto);
  }

  @Get(':id/report.csv')
  async reportCsv(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SponsorReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.service.reportCsv(organizationId, id, query);
    return sendCsv(res, filename, csv);
  }

  /** ?from=YYYY-MM-DD&to=YYYY-MM-DD (opcionais, inclusivos, dia de Sao Paulo). So campanhas do proprio grupo. */
  @Get(':id/report')
  report(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @Query() query: SponsorReportQueryDto) {
    return this.service.report(organizationId, id, query);
  }

  @Get(':id')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.getCampaign(organizationId, id);
  }

  @Patch(':id')
  update(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSponsorCampaignDto) {
    return this.service.updateCampaign(organizationId, id, dto);
  }

  /** Apaga a campanha e as estatisticas dela. */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.deleteCampaign(organizationId, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser('id') userId: number) {
    return this.service.activate(organizationId, id, userId);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.pause(organizationId, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.service.resume(organizationId, id);
  }
}
