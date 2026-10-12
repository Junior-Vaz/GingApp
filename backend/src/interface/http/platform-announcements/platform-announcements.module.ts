import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformAnnouncementsController } from './platform-announcements.controller';
import { PlatformAnnouncementsService } from './platform-announcements.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PlatformAnnouncementsController],
  providers: [PlatformAnnouncementsService],
})
export class PlatformAnnouncementsModule {}
