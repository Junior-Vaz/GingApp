import { Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser('id') userId: number) {
    return this.notificationsService.findAllForUser(userId);
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
