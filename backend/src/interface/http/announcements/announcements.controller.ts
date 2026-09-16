import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CurrentOrganization } from '../../../shared/decorators/current-organization.decorator';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { CanAccess } from '../../../shared/decorators/can-access.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  @CanAccess('announcements', 'view')
  findAll(@CurrentOrganization() organizationId: number) {
    return this.announcementsService.findAll(organizationId);
  }

  @Get(':id')
  @CanAccess('announcements', 'view')
  findOne(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.findOne(organizationId, id);
  }

  @Post()
  @CanAccess('announcements', 'create')
  create(
    @CurrentOrganization() organizationId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcementsService.create(organizationId, userId, dto);
  }

  @Patch(':id')
  @CanAccess('announcements', 'edit')
  update(
    @CurrentOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcementsService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @CanAccess('announcements', 'delete')
  remove(@CurrentOrganization() organizationId: number, @Param('id', ParseIntPipe) id: number) {
    return this.announcementsService.remove(organizationId, id);
  }
}
