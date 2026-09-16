import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../../shared/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser('id') userId: number) {
    return this.notificationsService.findAllForUser(userId);
  }
}
