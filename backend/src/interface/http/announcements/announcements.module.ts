import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { AnnouncementsController } from './announcements.controller';
import { QuickSendController } from './quick-send.controller';
import { QuickSendService } from './quick-send.service';
import { QuickTemplatesController } from './quick-templates.controller';
import { QuickTemplatesService } from './quick-templates.service';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [StudentsModule, NotificationsModule],
  controllers: [AnnouncementsController, QuickSendController, QuickTemplatesController],
  providers: [AnnouncementsService, QuickSendService, QuickTemplatesService],
  // QuickSendService: o Comunicar (communications) reaproveita `activeOnly` (nunca enviar a quem foi desativado).
  exports: [AnnouncementsService, QuickSendService],
})
export class AnnouncementsModule {}
