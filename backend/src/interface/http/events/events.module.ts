import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RankingModule } from '../ranking/ranking.module';
import { StudentsModule } from '../students/students.module';
import { EventsCheckinService } from './events-checkin.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [StudentsModule, NotificationsModule, RankingModule],
  controllers: [EventsController],
  providers: [EventsService, EventsCheckinService],
  exports: [EventsService],
})
export class EventsModule {}
