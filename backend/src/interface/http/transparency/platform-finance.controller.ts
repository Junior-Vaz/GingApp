import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { sendCsv } from '../../../shared/csv/csv';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import {
  CreateLedgerEntryDto,
  LedgerCsvQueryDto,
  ListLedgerEntriesQueryDto,
  PublishMonthDto,
  UpdateLedgerEntryDto,
  UpdateTransparencySettingsDto,
} from './dto/transparency.dto';
import { TransparencyService } from './transparency.service';

/**
 * Livro-caixa e transparencia da plataforma (equipe PLATFORM, admin.gingapp.com.br; docs/CONTRATO_TRANSPARENCIA.md 3).
 * Ler: qualquer PLATFORM. Escrever (lancar, editar, excluir, publicar, despublicar, configurar): SO super admin ATIVO
 * (SuperAdminGuard: 403 antes de qualquer validacao). Listas: corpo = array + total em X-Total-Count.
 */
@Controller('platform-finance')
@UseGuards(PlatformOnlyGuard)
export class PlatformFinanceController {
  constructor(private readonly service: TransparencyService) {}

  /** ?month=YYYY-MM&type=&category=&q=&limit=&offset= (ordem: occurredOn desc, id desc). */
  @Get('entries')
  async listEntries(@Query() query: ListLedgerEntriesQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.listEntries(query));
  }

  /** CSV (UTF-8 com BOM, ';', anti formula-injection). ?month= opcional. */
  @Get('entries.csv')
  async entriesCsv(@Query() query: LedgerCsvQueryDto, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { filename, csv, total } = await this.service.entriesCsv(query);
    return sendCsv(res, filename, csv, total);
  }

  @Post('entries')
  @UseGuards(SuperAdminGuard)
  createEntry(@Body() dto: CreateLedgerEntryDto, @CurrentUser('id') userId: number) {
    return this.service.createEntry(dto, userId);
  }

  @Patch('entries/:id')
  @UseGuards(SuperAdminGuard)
  updateEntry(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLedgerEntryDto) {
    return this.service.updateEntry(id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @UseGuards(SuperAdminGuard)
  deleteEntry(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.deleteEntry(id);
  }

  @Get('months')
  listMonths() {
    return this.service.listMonths();
  }

  @Post('months/:month/publish')
  @UseGuards(SuperAdminGuard)
  publish(@Param('month') month: string, @Body() dto: PublishMonthDto, @CurrentUser('id') userId: number) {
    return this.service.publish(month, dto, userId);
  }

  @Post('months/:month/unpublish')
  @HttpCode(204)
  @UseGuards(SuperAdminGuard)
  unpublish(@Param('month') month: string): Promise<void> {
    return this.service.unpublish(month);
  }

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  @UseGuards(SuperAdminGuard)
  updateSettings(@Body() dto: UpdateTransparencySettingsDto, @CurrentUser('id') userId: number) {
    return this.service.updateSettings(dto, userId);
  }

  /** Exatamente o corpo que GET /transparency devolveria agora (conferencia antes de publicar). */
  @Get('preview')
  preview() {
    return this.service.publicReport();
  }
}
