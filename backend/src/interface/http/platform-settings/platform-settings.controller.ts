import { Body, Controller, Delete, Get, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { SuperAdminGuard } from '../../../shared/guards/super-admin.guard';
import { sendPage } from '../../../shared/pagination/pagination';
import { ListPlatformSettingsQueryDto } from './dto/list-platform-settings-query.dto';
import { UpsertPlatformSettingDto } from './dto/upsert-platform-setting.dto';
import { PlatformSettingsService } from './platform-settings.service';

/** Configurações globais da plataforma — exclusivo da equipe PLATFORM. Nada as consome ainda
 * (ver PlatformSettingsService). Ler (GET): qualquer PLATFORM. Escrever (PUT/DELETE): só super
 * admin ATIVO (SuperAdminGuard — mesma regra da gestão da equipe); os demais recebem 403. */
@Controller('platform-settings')
@UseGuards(PlatformOnlyGuard)
export class PlatformSettingsController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Get()
  async findAll(@Query() query: ListPlatformSettingsQueryDto, @Res({ passthrough: true }) res: Response) {
    return sendPage(res, await this.service.findAll(query));
  }

  @Get(':key')
  findOne(@Param('key') key: string) {
    return this.service.findOne(key);
  }

  @Put(':key')
  @UseGuards(SuperAdminGuard)
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertPlatformSettingDto,
    @CurrentUser('id') userId: number,
  ) {
    return this.service.upsert(key, dto, userId);
  }

  @Delete(':key')
  @UseGuards(SuperAdminGuard)
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
