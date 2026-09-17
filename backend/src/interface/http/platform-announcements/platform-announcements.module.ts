import { Module } from '@nestjs/common';
import { PlatformAnnouncementsController } from './platform-announcements.controller';
import { PlatformAnnouncementsService } from './platform-announcements.service';

@Module({
  controllers: [PlatformAnnouncementsController],
  providers: [PlatformAnnouncementsService],
})
export class PlatformAnnouncementsModule {}
