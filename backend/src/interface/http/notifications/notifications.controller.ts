import { Controller, Get, Param, ParseIntPipe, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LimitOffsetQueryDto, sendPage } from '../../../shared/pagination/pagination';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(
    @CurrentUser('id') userId: number,
    @Query() query: LimitOffsetQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendPage(res, await this.notificationsService.findAllForUser(userId, query));
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('id') userId: number) {
    return this.notificationsService.countUnreadForUser(userId);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser('id') userId: number) {
    return this.notificationsService.markAllAsRead(userId);
  }

  @Patch(':id/read')
  markAsRead(@CurrentUser('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.markAsRead(userId, id);
  }
}
