import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { PlatformOnlyGuard } from '../../../shared/guards/platform-only.guard';
import { PlatformAnnouncementsService } from './platform-announcements.service';
import { CreatePlatformAnnouncementDto } from './dto/create-platform-announcement.dto';
import { UpdatePlatformAnnouncementDto } from './dto/update-platform-announcement.dto';

@Controller('platform-announcements')
export class PlatformAnnouncementsController {
  constructor(private readonly platformAnnouncementsService: PlatformAnnouncementsService) {}

  /** Único endpoint deste controller acessível a um MEMBER — o que o grupo vê no seu PWA/painel.
   * Sem @UseGuards(PlatformOnlyGuard): escopado por CurrentOrganization, nunca por um :id vindo
   * do cliente. Precisa vir antes de qualquer rota ':id' do controller. */
  @Get('mine')
  findMine(@CurrentOrganization() organizationId: number) {
    return this.platformAnnouncementsService.findActiveForOrganization(organizationId);
  }

  @Get()
  @UseGuards(PlatformOnlyGuard)
  findAll() {
    return this.platformAnnouncementsService.findAll();
  }

  @Get(':id')
  @UseGuards(PlatformOnlyGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.platformAnnouncementsService.findOne(id);
  }

  @Post()
  @UseGuards(PlatformOnlyGuard)
  create(@CurrentUser('id') createdByUserId: number, @Body() dto: CreatePlatformAnnouncementDto) {
    return this.platformAnnouncementsService.create(createdByUserId, dto);
  }

  @Patch(':id')
  @UseGuards(PlatformOnlyGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlatformAnnouncementDto) {
    return this.platformAnnouncementsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PlatformOnlyGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.platformAnnouncementsService.remove(id);
  }
}
