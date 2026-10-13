import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { AnnouncementsController } from './announcements.controller';
import { QuickSendController } from './quick-send.controller';
import { QuickSendService } from './quick-send.service';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  controllers: [AnnouncementsController, QuickSendController],
  providers: [AnnouncementsService, QuickSendService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
